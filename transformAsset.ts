const STORYBLOK_HOST = 'https://a.storyblok.com';
const DEFAULT_ASSETS_PATH = '/web-assets';

const getAssetsHostDomain = (): string =>
	import.meta.env.HOST_ASSETS_URL || DEFAULT_ASSETS_PATH;

const transformAsset = (
	src: string,
	transformer?: (path: string) => string
): string => {
	if (!src) return src;

	const shouldUseNfonHost = import.meta.env.NFON_IMAGE_HOST === 'yes';
	let transformedSrc = src;

	if (shouldUseNfonHost && src.startsWith(STORYBLOK_HOST)) {
		transformedSrc = src.replace(STORYBLOK_HOST, getAssetsHostDomain());
	}

	return transformer ? transformer(transformedSrc) : transformedSrc;
};

export default transformAsset;
