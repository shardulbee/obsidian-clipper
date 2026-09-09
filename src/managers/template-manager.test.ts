// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from 'vitest';
import browser from '../utils/browser-polyfill';
import { loadTemplates } from './template-manager';
import type { Template } from '../types/types';

const managedTemplate: Template = {
	id: 'managed',
	name: 'Managed',
	behavior: 'create',
	noteNameFormat: '{{title}}',
	path: 'Clippings',
	noteContentFormat: '{{content}}',
	properties: [],
	triggers: [],
};

beforeEach(() => {
	browser.storage.managed.get = vi.fn(async () => ({})) as typeof browser.storage.managed.get;
	browser.storage.sync.get = vi.fn(async () => ({})) as typeof browser.storage.sync.get;
	browser.storage.sync.set = vi.fn(async () => {}) as typeof browser.storage.sync.set;
});

describe('loadTemplates', () => {
	test('uses managed templates instead of synchronized templates', async () => {
		browser.storage.managed.get = vi.fn(async () => ({
			templates: JSON.stringify([managedTemplate]),
		})) as typeof browser.storage.managed.get;

		await expect(loadTemplates()).resolves.toEqual([managedTemplate]);
		expect(browser.storage.sync.get).not.toHaveBeenCalled();
	});

	test('falls back to synchronized templates when no policy exists', async () => {
		await loadTemplates();
		expect(browser.storage.sync.get).toHaveBeenCalledWith(['template_list']);
	});
});
