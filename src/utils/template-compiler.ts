// Template compiler for the Web Clipper template engine
// This module provides the main entry point for template compilation,
// integrating the AST-based renderer with the variable processors.

import { createEngine } from '@obsidianmd/knap';
import { clipperFilters, type ClipperTemplateContext } from './filters';
import { processSimpleVariable } from './variables/simple';
import { processSelector, resolveSelector } from './variables/selector';
import { processSchema } from './variables/schema';
import { processPrompt } from './variables/prompt';
import { isModelVariable, processModelVariable } from './variables/model';

export interface RenderContext {
	variables: Record<string, any>;
	currentUrl: string;
	tabId?: number;
}

export type AsyncResolver = (name: string, context: RenderContext) => Promise<any>;

const engine = createEngine<ClipperTemplateContext>({ filters: clipperFilters });

interface DeferredTemplates {
	template: string;
	variables: Record<string, string>;
}

/**
 * Prompt expressions and interpreter model variables must survive the first
 * render pass. Knap remains application-neutral, so Clipper temporarily maps
 * them to ordinary variables and restores their original template syntax in
 * the rendered output for the interpreter-specific post-processing pass.
 */
function protectDeferredTemplates(text: string, variables: Record<string, any>): DeferredTemplates {
	const deferredVariables: Record<string, string> = {};
	let deferredIndex = 0;

	const template = text.replace(/{{(-)?\s*([\s\S]*?)\s*(-)?}}/g, (match, trimLeft, expression, trimRight) => {
		const value = String(expression).trim();
		const isPrompt = /^(?:prompt:)?["']/.test(value);
		const isModel = /^(?:model|modelId|modelProvider)(?:\s*\||\s*$)/.test(value);

		if (!isPrompt && !isModel) {
			return match;
		}

		let key: string;
		do {
			key = `__knap_deferred_${deferredIndex++}`;
		} while (key in variables || key in deferredVariables);

		deferredVariables[key] = match;
		return `{{${trimLeft ? '-' : ''}${key}${trimRight ? '-' : ''}}}`;
	});

	return { template, variables: deferredVariables };
}

/**
 * A function that processes a selector match string and returns the result.
 * Used to inject different selector implementations (browser vs CLI).
 */
export type SelectorProcessor = (match: string, currentUrl: string) => Promise<string>;

/**
 * Main function to compile a template with the given variables.
 *
 * @param tabId - Browser tab ID for selector resolution (0 if not applicable)
 * @param text - Template string to compile
 * @param variables - Variables available in the template
 * @param currentUrl - Current page URL for filter processing
 * @param customAsyncResolver - Optional async resolver override (defaults to browser selector resolver)
 * @param customSelectorProcessor - Optional selector processor override for post-processing
 * @returns Compiled template string
 */
export async function compileTemplate(
	tabId: number,
	text: string,
	variables: { [key: string]: any },
	currentUrl: string,
	customAsyncResolver?: AsyncResolver,
	customSelectorProcessor?: SelectorProcessor
): Promise<string> {
	// Strip text fragment from URL
	currentUrl = currentUrl.replace(/#:~:text=[^&]+(&|$)/, '');
	const deferred = protectDeferredTemplates(text, variables);

	// Keep application-specific variable resolution outside the shared engine.
	const resolveVariable = async (name: string): Promise<any> => {
		if (customAsyncResolver) {
			const value = await customAsyncResolver(name, {
				variables,
				currentUrl,
				tabId,
			});
			if (value !== undefined) {
				return value;
			}
		}

		if (name.startsWith('selector:') || name.startsWith('selectorHtml:')) {
			return resolveSelector(tabId, name);
		}
		if (name.startsWith('schema:')) {
			return processSchema(`{{${name}}}`, variables, currentUrl);
		}

		return undefined;
	};

	const result = await engine.render(deferred.template, {
		variables: {
			...variables,
			...deferred.variables,
		},
		context: { tabId, currentUrl },
		resolveVariable,
	});

	// Log any errors (but don't fail - return partial output)
	if (result.errors.length > 0) {
		console.error('Template compilation errors:', result.errors.map(e => `Line ${e.line}: ${e.message}`).join('; '));
	}

	// Skip application post-processing if no prompt/model expressions were protected.
	if (Object.keys(deferred.variables).length === 0) {
		return result.output;
	}

	// Post-process: handle special variable types that weren't processed by the renderer
	// The renderer handles basic variables, but special prefixes need custom processing
	const processedText = await processVariables(tabId, result.output, variables, currentUrl, customSelectorProcessor);

	return processedText;
}

/**
 * Process variables and apply filters.
 * Handles special variable types: selector, schema, prompt.
 *
 * This is called after the AST-based renderer to handle any remaining
 * variable interpolations that need special processing.
 */
export async function processVariables(
	tabId: number,
	text: string,
	variables: { [key: string]: any },
	currentUrl: string,
	customSelectorProcessor?: SelectorProcessor
): Promise<string> {
	const regex = /{{([\s\S]*?)}}/g;
	let result = text;
	let match;

	while ((match = regex.exec(result)) !== null) {
		const fullMatch = match[0];
		const trimmedMatch = match[1].trim();

		let replacement: string;

		if (trimmedMatch.startsWith('selector:') || trimmedMatch.startsWith('selectorHtml:')) {
			if (customSelectorProcessor) {
				replacement = await customSelectorProcessor(fullMatch, currentUrl);
			} else {
				replacement = await processSelector(tabId, fullMatch, currentUrl);
			}
		} else if (trimmedMatch.startsWith('schema:')) {
			replacement = await processSchema(fullMatch, variables, currentUrl);
		} else if (trimmedMatch.startsWith('"') || trimmedMatch.startsWith('prompt:')) {
			replacement = await processPrompt(fullMatch, variables, currentUrl);
		} else if (isModelVariable(trimmedMatch)) {
			replacement = await processModelVariable(fullMatch);
		} else {
			replacement = await processSimpleVariable(trimmedMatch, variables, currentUrl);
		}

		result = result.substring(0, match.index) + replacement + result.substring(match.index + fullMatch.length);
		regex.lastIndex = match.index + replacement.length;
	}

	return result;
}
