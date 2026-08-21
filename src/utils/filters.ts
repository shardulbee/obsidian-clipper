import {
	standardFilters,
	type FilterMetadata,
	type FilterRegistry,
	type TemplateFilter,
} from '@obsidian/knap';
import { htmlFilters } from '@obsidian/knap/html';
import { debugLog } from './debug';
import { createParserState, processCharacter } from './parser-utils';
import { fragment_link } from './filters/fragment_link';
import { markdown } from './filters/markdown';

export type { FilterMetadata, ParamValidationResult, ParamValidator } from '@obsidian/knap';

// ============================================================================
// Filter Metadata for Validation
// ============================================================================

const markdownFilter: TemplateFilter = (value, param, context) =>
	markdown(value, param ?? context?.currentUrl);
markdownFilter.metadata = {};

const fragmentLinkFilter: TemplateFilter = (value, param, context) => {
	const combinedParam = [param, context?.currentUrl].filter(Boolean).join(':');
	return fragment_link(value, combinedParam);
};
fragmentLinkFilter.metadata = {};

/** Knap's shared filters plus the browser/Defuddle filters enabled by Clipper. */
export const clipperFilters: Readonly<FilterRegistry> = Object.freeze({
	...standardFilters,
	...htmlFilters,
	markdown: markdownFilter,
	fragment_link: fragmentLinkFilter,
});

export const filters: Readonly<FilterRegistry> = clipperFilters;

export const filterMetadata: Record<string, FilterMetadata> = Object.fromEntries(
	Object.entries(clipperFilters).map(([name, filter]) => [name, filter.metadata ?? {}]),
);

export const validFilterNames = new Set(Object.keys(clipperFilters));

// Split individual filters
function splitFilterString(filterString: string): string[] {
	const filters: string[] = [];
	const state = createParserState();

	// Remove all spaces before and after | that are not within quotes or parentheses
	filterString = filterString.replace(/\s*\|\s*(?=(?:[^"'()]*["'][^"'()]*["'])*[^"'()]*$)/g, '|');

	// Iterate through each character in the filterString
	for (let i = 0; i < filterString.length; i++) {
		const char = filterString[i];

		// Split filters on pipe character when not in quotes, regex, or parentheses
		if (char === '|' && !state.inQuote && !state.inRegex && 
			state.curlyDepth === 0 && state.parenDepth === 0) {
			filters.push(state.current.trim());
			state.current = '';
		} else {
			// For any other character, add it to the current filter
			processCharacter(char, state);
		}
	}

	if (state.current) {
		filters.push(state.current.trim());
	}

	return filters;
}

// Parse the filter into name and parameters
function parseFilterString(filterString: string): string[] {
	const parts: string[] = [];
	const state = createParserState();

	// Iterate through each character in the filterString
	for (let i = 0; i < filterString.length; i++) {
		const char = filterString[i];

		if (char === ':' && !state.inQuote && !state.inRegex && 
			state.parenDepth === 0 && parts.length === 0) {
			parts.push(state.current.trim());
			state.current = '';
		} else {
			processCharacter(char, state);
		}
	}

	if (state.current) {
		parts.push(state.current.trim());
	}

	return parts;
}

/**
 * Apply a single filter by name with a pre-formatted parameter string.
 * Use this when you already have the filter name and parameters separated.
 * For filter strings like "filter1:arg|filter2", use applyFilters() instead.
 *
 * @param value - The input value to filter
 * @param filterName - The name of the filter to apply (e.g., "replace", "slice")
 * @param paramString - The parameter string without the filter name (e.g., "0,5" for slice:0,5)
 * @param currentUrl - Optional current URL for filters that need it
 * @returns The filtered value as a string
 */
export function applyFilterDirect(
	value: string | any[],
	filterName: string,
	paramString: string | undefined,
	currentUrl?: string
): string {
	debugLog('Filters', 'applyFilterDirect called with:', { value, filterName, paramString, currentUrl });

	const filter = filters[filterName];
	if (!filter) {
		console.error(`Invalid filter: ${filterName}`);
		debugLog('Filters', `Available filters:`, Object.keys(filters));
		return typeof value === 'string' ? value : JSON.stringify(value);
	}

	// Convert the input to a string if it's not already
	const stringInput = typeof value === 'string' ? value : JSON.stringify(value);

	// Apply the filter
	const output = filter(stringInput, paramString, {
		variables: {},
		currentUrl,
	});

	debugLog('Filters', `Filter ${filterName} output:`, output);

	// If the output is a string that looks like JSON, try to parse it
	if (typeof output === 'string' && (output.startsWith('[') || output.startsWith('{'))) {
		try {
			const parsed = JSON.parse(output);
			return JSON.stringify(parsed);
		} catch {
			return output;
		}
	}

	return typeof output === 'string' ? output : JSON.stringify(output);
}

/**
 * Apply filters from a filter string (legacy path).
 * Used when filters are specified as a string like "filter1:arg|filter2".
 * For the optimized path with pre-parsed filters, use applyFilterDirect.
 */
export function applyFilters(value: string | any[], filterString: string, currentUrl?: string): string {
	debugLog('Filters', 'applyFilters called with:', { value, filterString, currentUrl });

	if (!filterString) {
		debugLog('Filters', 'Empty filter string, returning original value');
		return typeof value === 'string' ? value : JSON.stringify(value);
	}

	let processedValue = value;

	// Split the filter string into individual filter names, accounting for escaped pipes and quotes
	const filterNames = splitFilterString(filterString);
	debugLog('Filters', 'Split filter string:', filterNames);

	// Reduce through all filter names, applying each filter sequentially
	const result = filterNames.reduce((result, filterName) => {
			// Parse the filter string into name and parameters
			const [name, ...params] = parseFilterString(filterName);
			debugLog('Filters', `Parsed filter: ${name}, Params:`, params);

			// Get the filter function from the filters object
			const filter = filters[name];
			if (filter) {
				// Convert the input to a string if it's not already
				const stringInput = typeof result === 'string' ? result : JSON.stringify(result);

				// Apply the filter and get the output
				const output = filter(stringInput, params.join(':'), {
					variables: {},
					currentUrl,
				});

				debugLog('Filters', `Filter ${name} output:`, output);

				// If the output is a string that looks like JSON, try to parse it
				if (typeof output === 'string' && (output.startsWith('[') || output.startsWith('{'))) {
					try {
						return JSON.parse(output);
					} catch {
						return output;
					}
				}
				return output;
			} else {
				// If the filter doesn't exist, log an error and return the unmodified result
				console.error(`Invalid filter: ${name}`);
				debugLog('Filters', `Available filters:`, Object.keys(filters));
				return result;
			}
		}, processedValue);

	// Ensure the final result is a string
	return typeof result === 'string' ? result : JSON.stringify(result);
}
