// Detecting the tool the course was made in (authoring tool).
// First we look for characteristic files and folders, then mentions in the manifest
// and in the start HTML page, and finally the <meta name="generator"> tag.

interface Rule {
  tool: string;
  /** Characteristic paths inside the package (lowercase) */
  paths?: RegExp;
  /** Mentions in the manifest and the start page */
  text?: RegExp;
}

const RULES: Rule[] = [
  { tool: 'neoScorm', paths: /(^|\/)neoscorm[^/]*$/, text: /neoscorm/i },
  { tool: 'Articulate Rise 360', paths: /^scormcontent\/|(^|\/)lib\/rise\//, text: /articulate rise|rise 360/i },
  { tool: 'Articulate Storyline', paths: /(^|\/)story_content\/|(^|\/)story(_html5|_flash)?\.html$/, text: /articulate storyline/i },
  { tool: 'Articulate Presenter', paths: /(^|\/)presentation_content\// },
  { tool: 'Articulate Quizmaker', paths: /(^|\/)quiz_content\// },
  { tool: 'Articulate Engage', paths: /(^|\/)engage_content\// },
  { tool: 'Adobe Captivate', paths: /(^|\/)(cpm\.js|cpxhrloader\.js|captivate\.css)$/, text: /captivate/i },
  { tool: 'Adobe Presenter', text: /adobe presenter/i },
  { tool: 'iSpring', paths: /ispring/, text: /ispring/i },
  { tool: 'Lectora', paths: /trivantis|(^|\/)a001index\.html$/, text: /lectora|trivantis/i },
  { tool: 'Adapt', paths: /(^|\/)adapt\/js\/adapt(\.min)?\.js$/, text: /adapt ?learning|adaptlearning/i },
  { tool: 'Elucidat', paths: /elucidat/, text: /elucidat/i },
  { tool: 'dominKnow', paths: /dominknow/, text: /dominknow/i },
  { tool: 'Gomo', paths: /(^|\/)gomo/, text: /gomo learning/i },
  { tool: 'Evolve', text: /evolve authoring/i },
  { tool: 'H5P', paths: /(^|\/)h5p\.json$|(^|\/)h5p-/, text: /\bh5p\b/i },
  { tool: 'Camtasia', paths: /techsmith|camtasia/, text: /techsmith|camtasia/i },
  { tool: 'Easygenerator', paths: /easygenerator/, text: /easygenerator/i },
  { tool: 'CourseLab', paths: /courselab/, text: /courselab/i },
  { tool: 'eXeLearning', paths: /exe_jquery|exe_lightbox|exelearning/, text: /exelearning|exe learning/i },
  { tool: 'SmartBuilder', paths: /smartbuilder/, text: /smartbuilder/i },
  { tool: 'Raptivity', paths: /raptivity/, text: /raptivity/i },
];

export const UNKNOWN_TOOL = 'Unknown';

export function detectTool(paths: string[], manifestText: string, launchHead: string): string {
  const lowerPaths = paths.map((p) => p.toLowerCase());
  for (const rule of RULES) {
    if (rule.paths && lowerPaths.some((p) => rule.paths!.test(p))) return rule.tool;
  }
  const textBlob = `${manifestText}\n${launchHead}`;
  for (const rule of RULES) {
    if (rule.text && rule.text.test(textBlob)) return rule.tool;
  }
  // <meta name="generator" content="..."> — the attributes can come in any order
  const meta =
    launchHead.match(/<meta[^>]+name=["']generator["'][^>]*content=["']([^"']+)["']/i)?.[1] ??
    launchHead.match(/<meta[^>]+content=["']([^"']+)["'][^>]*name=["']generator["']/i)?.[1];
  if (meta) return meta.trim().slice(0, 40);
  return UNKNOWN_TOOL;
}
