import { describe, expect, test } from 'vitest';
import { applyFilters, clipperFilters } from './filters';

describe('Clipper filter adapter', () => {
	test('runs standard filter chains through Knap', () => {
		expect(applyFilters(' Shared Language ', 'trim|lower|replace:" ":"-"'))
			.toBe('shared-language');
	});

	test('adds Clipper environment filters to the registry', () => {
		expect(clipperFilters).toHaveProperty('markdown');
		expect(clipperFilters).toHaveProperty('html_to_json');
	});

	test('passes the current URL to fragment links', () => {
		const output = JSON.parse(applyFilters(
			'"Selected text"',
			'fragment_link',
			'https://example.com/article',
		));

		expect(output).toEqual([
			'Selected text [link](https://example.com/article#:~:text=Selected%20text)',
		]);
	});
});
