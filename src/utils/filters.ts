import {
	applyFiltersWithRegistry,
	standardFilters,
	type FilterRegistry,
	type TemplateFilter,
} from '@obsidianmd/knap';
import { htmlFilters } from '@obsidianmd/knap/html';
import { markdown } from './filters/markdown';

const markdownFilter: TemplateFilter = (value, param, context) =>
	markdown(value, param ?? context?.currentUrl);
markdownFilter.metadata = {};

const fragmentLinkFilter: TemplateFilter = (value, param, context) => {
	const combinedParam = [param, context?.currentUrl].filter(Boolean).join(':');
	return standardFilters.fragment_link(value, combinedParam, context);
};
fragmentLinkFilter.metadata = {};

/** Knap's shared filters plus the browser/Defuddle filters enabled by Clipper. */
export const clipperFilters: Readonly<FilterRegistry> = Object.freeze({
	...standardFilters,
	...htmlFilters,
	markdown: markdownFilter,
	fragment_link: fragmentLinkFilter,
});

/** Apply a filter chain in Clipper-only post-processing paths. */
export function applyFilters(
	value: string | any[],
	filterString: string,
	currentUrl?: string,
): string {
	return applyFiltersWithRegistry(value, filterString, clipperFilters, {
		variables: {},
		currentUrl,
	});
}
