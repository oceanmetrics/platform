export const SITE_DIR: string
export const MARK_FILE: string
export const SPRITE_FILE: string
export const GLYPHS: string[]
export function tidyPath(d: string): string
export function markPaths(svg: string): { ring: string[]; spark: string }
export function symbolPath(sprite: string, id: string): string
export function glyphSource(dir?: string): string
