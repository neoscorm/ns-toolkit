// Content categories by file extension

import type { Category } from '../types';
import { extOf } from '../util';

const EXT = new Map<string, Category>();
const add = (cat: Category, list: string) => list.split(' ').forEach((e) => EXT.set(e, cat));

add('video', 'mp4 m4v webm mov avi wmv flv f4v ogv mkv mpg mpeg 3gp');
add('audio', 'mp3 wav m4a aac ogg oga wma flac');
add('images', 'png jpg jpeg gif svg webp bmp tif tiff ico avif');
add('code', 'html htm xhtml js mjs css json xml xsd dtd txt map');
add('fonts', 'woff woff2 ttf otf eot');
add('documents', 'pdf doc docx ppt pptx xls xlsx odt odp ods rtf');
add('flash', 'swf fla');

export function categoryOf(path: string): Category {
  return EXT.get(extOf(path)) ?? 'other';
}

/** Order of the layers in the diagram and labels for people */
export const CATEGORIES: { key: Category; label: string }[] = [
  { key: 'video', label: 'Video' },
  { key: 'audio', label: 'Audio' },
  { key: 'images', label: 'Images' },
  { key: 'code', label: 'Pages and scripts' },
  { key: 'fonts', label: 'Fonts' },
  { key: 'documents', label: 'Documents' },
  { key: 'other', label: 'Other' },
  { key: 'flash', label: 'Flash' },
];
