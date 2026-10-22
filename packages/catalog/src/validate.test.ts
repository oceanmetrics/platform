import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { listProfiles, loadSchema, validate } from './validate.js'
import { run, USAGE } from './cli.js'

// ---- fixtures ----

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url))
const jsonFiles = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.json')).sort() : [])
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as any
const fixture = (profile: string, file: string) => read(join(FIXTURES, profile, 'valid', `${file}.json`))
/** a copy of `doc` changed by `fn`. */
const edit = (doc: any, fn: (d: any) => void) => {
  const d = structuredClone(doc)
  fn(d)
  return d
}
const errorsOf = (profile: string, doc: unknown) => validate(profile, doc).errors
const passes = (profile: string, doc: unknown) => expect(errorsOf(profile, doc)).toEqual([])
const fails = (profile: string, doc: unknown, sub: string) => {
  const errors = errorsOf(profile, doc)
  expect(errors.length).toBeGreaterThan(0)
  expect(errors.join('\n')).toContain(sub)
}

// ---- every schema, every fixture (a profile added on another branch is covered once merged) ----

describe.each(listProfiles())('profile %s', name => {
  const dir = join(FIXTURES, name)
  const valid = jsonFiles(join(dir, 'valid'))
  const invalid = jsonFiles(join(dir, 'invalid'))
  const expected: Record<string, string> = existsSync(join(dir, 'invalid.json')) ? read(join(dir, 'invalid.json')) : {}

  it('has its $id at oceanmetrics.io/schemas/<name>/v1.0.0, draft 2020-12, and no cross-file $ref', () => {
    const schema = loadSchema(name)
    expect(schema.$id).toBe(`https://oceanmetrics.io/schemas/${name}/v1.0.0/schema.json`)
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema')
    const refs = [...JSON.stringify(schema).matchAll(/"\$ref":"([^"]*)"/g)].map(m => m[1])
    expect(refs.filter(r => !r.startsWith('#'))).toEqual([])
  })
  it('has at least one valid and one invalid fixture, and an expected error for each invalid one', () => {
    expect(valid.length).toBeGreaterThan(0)
    expect(invalid.length).toBeGreaterThan(0)
    expect(Object.keys(expected).sort()).toEqual(invalid)
  })
  it.each(valid)('valid/%s passes', file => passes(name, read(join(dir, 'valid', file))))
  it.each(invalid)('invalid/%s fails with its expected error', file => fails(name, read(join(dir, 'invalid', file)), expected[file]))
})

describe('the STAC layer profiles', () => {
  // every property the profiles define says what it is (Python readers and the README quote these); an if condition is
  // exempt, it restates a property described elsewhere
  const SUB = ['items', 'additionalProperties', 'not', 'then', 'else', 'contains', 'propertyNames']
  const LISTS = ['prefixItems', 'allOf', 'anyOf', 'oneOf']
  const undescribed = (s: any, path: string, out: string[]): string[] => {
    if (!s || typeof s !== 'object') return out
    for (const [p, sub] of Object.entries<any>(s.properties ?? {})) {
      if (!sub.description) out.push(`${path}/properties/${p}`)
      undescribed(sub, `${path}/properties/${p}`, out)
    }
    for (const k of SUB) undescribed(s[k], `${path}/${k}`, out)
    for (const k of LISTS) (s[k] ?? []).forEach((x: unknown, i: number) => undescribed(x, `${path}/${k}/${i}`, out))
    for (const [k, d] of Object.entries(s.$defs ?? {})) undescribed(d, `${path}/$defs/${k}`, out)
    return out
  }
  it.each(['erddap-grid', 'cog', 'h3', 'atlas-collection', 'atlas-item', 'sdm-dossier'])('%s describes every property', name => {
    expect(undescribed(loadSchema(name), '', [])).toEqual([])
  })
  it('lets STAC core and unknown keys through at the top level and in properties', () => {
    passes('cog', edit(fixture('cog', 'aquamaps_like_core_bands'), d => {
      d.whatever = 1
      d.properties['other:field'] = { any: 'thing' }
    }))
  })
  it('requires type, stac_version and id', () => {
    const doc = fixture('h3', 'hex_twin_res7')
    for (const k of ['type', 'stac_version', 'id']) fails('h3', edit(doc, d => delete d[k]), `'${k}'`)
  })
})

describe('loadSchema and listProfiles', () => {
  it('lists the schemas found in schemas/, sorted', () => {
    const names = listProfiles()
    expect(names).toEqual([...names].sort())
    expect(names).toEqual(expect.arrayContaining(['erddap-grid', 'cog', 'h3', 'atlas-collection', 'atlas-item', 'sdm-dossier', 'om-notebook']))
  })
  it('throws on an unknown profile, naming the known ones', () => {
    expect(() => loadSchema('nope')).toThrow(/unknown profile "nope"; known: .*erddap-grid/)
    expect(() => loadSchema('../package')).toThrow(/unknown profile/)
  })
  it('formats an error as <pointer>: <message>, / for the document itself', () => {
    expect(errorsOf('erddap-grid', edit(fixture('erddap-grid', 'dhw_5km_griddap'), d => delete d['erddap:cors'])))
      .toEqual(["/: must have required property 'erddap:cors'"])
  })
  it('reports a broken then-rule once, without the "must match then schema" echo', () => {
    expect(errorsOf('cog', read(join(FIXTURES, 'cog', 'invalid', 'band_without_statistics.json'))))
      .toEqual(["/assets/cog/raster:bands/1: must have required property 'statistics'"])
  })
})

// ---- erddap-grid ----

describe('erddap-grid rules', () => {
  const dhw = fixture('erddap-grid', 'dhw_5km_griddap')
  const bottle = fixture('erddap-grid', 'calcofi_bottle_tabledap')
  const P = 'erddap-grid'

  it('is a Collection', () => fails(P, edit(dhw, d => { d.type = 'Feature' }), '/type: must be equal to constant: "Collection"'))
  it('declares the datacube 2.2.0 extension', () => {
    fails(P, edit(dhw, d => { d.stac_extensions = ['https://stac-extensions.github.io/datacube/v2.1.0/schema.json'] }), '/stac_extensions')
  })
  it('gives erddap:base_url and erddap:upstream_url as URIs', () => {
    fails(P, edit(dhw, d => { d['erddap:base_url'] = 'erddap.example.org' }), '/erddap:base_url: must match format "uri"')
    fails(P, edit(dhw, d => { d['erddap:upstream_url'] = 'not a url' }), '/erddap:upstream_url')
  })
  it('requires every erddap: field', () => {
    for (const k of ['erddap:dataset_id', 'erddap:protocol', 'erddap:version', 'erddap:cors', 'erddap:formats', 'erddap:lon_range', 'erddap:lat_descending'])
      fails(P, edit(dhw, d => delete d[k]), `'${k}'`)
  })
  it('reads erddap:protocol as griddap or tabledap', () => fails(P, edit(dhw, d => { d['erddap:protocol'] = 'wms' }), '"griddap", "tabledap"'))
  it('types erddap:version as a string and erddap:cors as a boolean', () => {
    fails(P, edit(dhw, d => { d['erddap:version'] = 2.29 }), '/erddap:version: must be string')
    fails(P, edit(dhw, d => { d['erddap:cors'] = 'yes' }), '/erddap:cors: must be boolean')
  })
  it('lists at least one format', () => fails(P, edit(dhw, d => { d['erddap:formats'] = [] }), '/erddap:formats: must NOT have fewer than 1 items'))
  it('gives erddap:lon_range as exactly two numbers', () => {
    fails(P, edit(dhw, d => { d['erddap:lon_range'] = [0, 180, 360] }), '/erddap:lon_range: must NOT have more than 2 items')
    fails(P, edit(dhw, d => { d['erddap:lon_range'] = ['-180', 180] }), '/erddap:lon_range/0: must be number')
  })
  it('requires latitude and longitude dimensions for griddap only', () => {
    fails(P, edit(dhw, d => delete d['cube:dimensions'].latitude), "/cube:dimensions: must have required property 'latitude'")
    passes(P, bottle)
    expect(bottle['cube:dimensions'].latitude).toBeUndefined()
  })
  it('requires a time dimension with extent [string, string | null]', () => {
    fails(P, edit(dhw, d => delete d['cube:dimensions'].time), "'time'")
    passes(P, edit(dhw, d => { d['cube:dimensions'].time.extent = ['1985-04-01T12:00:00Z', null] }))
    fails(P, edit(dhw, d => { d['cube:dimensions'].time.extent = [null, null] }), '/cube:dimensions/time/extent/0')
    fails(P, edit(dhw, d => { d['cube:dimensions'].time.type = 'other' }), '/cube:dimensions/time/type')
  })
  it('gives latitude axis y and longitude axis x, with a numeric pair extent and a number or null step', () => {
    fails(P, edit(dhw, d => { d['cube:dimensions'].latitude.axis = 'x' }), '/cube:dimensions/latitude/axis')
    fails(P, edit(dhw, d => { d['cube:dimensions'].longitude.extent = [-180] }), '/cube:dimensions/longitude/extent')
    passes(P, edit(dhw, d => { d['cube:dimensions'].latitude.step = null }))
    fails(P, edit(dhw, d => { d['cube:dimensions'].latitude.step = '0.05' }), '/cube:dimensions/latitude/step')
  })
  it('allows a depth dimension on axis z with numeric values', () => {
    passes(P, edit(dhw, d => { d['cube:dimensions'].depth = { type: 'spatial', axis: 'z', extent: [0.5, 5], unit: 'm', values: [0.5, 5] } }))
    fails(P, edit(dhw, d => { d['cube:dimensions'].depth = { type: 'spatial', axis: 'y', extent: [0.5, 5] } }), '/cube:dimensions/depth/axis')
  })
  it('requires dimensions, type and unit (a string or null) on every variable', () => {
    passes(P, edit(dhw, d => { d['cube:variables'].CRW_SST.unit = null }))
    fails(P, edit(dhw, d => delete d['cube:variables'].CRW_SST.unit), "/cube:variables/CRW_SST: must have required property 'unit'")
    fails(P, edit(dhw, d => { d['cube:variables'].CRW_SST.type = 'measured' }), '/cube:variables/CRW_SST/type')
  })
  it('flags a categorical variable with a boolean and labels its classes with strings', () => {
    fails(P, edit(dhw, d => { d['cube:variables'].CRW_BAA['erddap-places:categorical'] = 1 }), '/cube:variables/CRW_BAA/erddap-places:categorical')
    fails(P, edit(dhw, d => { d['cube:variables'].CRW_BAA['erddap-places:classes']['4'] = 4 }), '/cube:variables/CRW_BAA/erddap-places:classes/4: must be string')
  })
  it('requires an asset with roles data and type application/vnd.apache.parquet', () => {
    fails(P, edit(dhw, d => { d.assets.griddap.type = 'application/json' }), '/assets: must NOT be valid')
    fails(P, edit(dhw, d => { d.assets.griddap.roles = ['external'] }), '/assets')
    passes(P, edit(dhw, d => { d.assets.griddap.href = 'anything, the template is not parsed' }))
  })
  it('allows erddap-places:status pending only, erddap-places:depth a number', () => {
    passes(P, edit(dhw, d => { d['erddap-places:status'] = 'pending'; d['erddap-places:depth'] = 0.49 }))
    fails(P, edit(dhw, d => { d['erddap-places:status'] = 'live' }), '/erddap-places:status')
    fails(P, edit(dhw, d => { d['erddap-places:depth'] = 'surface' }), '/erddap-places:depth')
  })
  it('gives erddap-places:long_format exactly type_column and value_column', () => {
    fails(P, edit(bottle, d => delete d['erddap-places:long_format'].value_column), "'value_column'")
    fails(P, edit(bottle, d => { d['erddap-places:long_format'].unit_column = 'u' }), 'must NOT have additional properties: "unit_column"')
  })
})

// ---- cog ----

describe('cog rules', () => {
  const cce = fixture('cog', 'cce_like_raster_bands')
  const aqm = fixture('cog', 'aquamaps_like_core_bands')
  const P = 'cog'

  it('is a Feature', () => fails(P, edit(aqm, d => { d.type = 'Collection' }), '/type'))
  it('requires properties.proj:code as EPSG:<n>, any code', () => {
    passes(P, edit(aqm, d => { d.properties['proj:code'] = 'EPSG:3857' }))
    fails(P, edit(aqm, d => { d.properties['proj:code'] = '4326' }), '/properties/proj:code: must match pattern')
    fails(P, edit(aqm, d => { d.properties['proj:code'] = 'ESRI:54009' }), '/properties/proj:code')
  })
  it('requires a data asset of the COG media type', () => {
    fails(P, edit(aqm, d => { d.assets.cog.type = 'image/tiff; application=geotiff' }), '/assets: must NOT be valid')
    passes(P, edit(aqm, d => { d.assets.cog.type = 'image/tiff;application=geotiff;profile=cloud-optimized' }))
  })
  it('requires bands or raster:bands on the data asset', () => {
    fails(P, edit(aqm, d => delete d.assets.cog.bands), "/assets/cog: must have required property 'bands'")
    fails(P, edit(aqm, d => delete d.assets.cog.bands), "must have required property 'raster:bands'")
  })
  it('requires band statistics with minimum and maximum', () => {
    fails(P, edit(aqm, d => delete d.assets.cog.bands[0].statistics.maximum), "/assets/cog/bands/0/statistics: must have required property 'maximum'")
    fails(P, edit(cce, d => { d.assets.cog['raster:bands'][0].statistics.valid_percent = 101 }), '/assets/cog/raster:bands/0/statistics/valid_percent')
  })
  it('reads data_type from the raster extension values', () => {
    fails(P, edit(aqm, d => { d.assets.cog.bands[0].data_type = 'byte' }), '/assets/cog/bands/0/data_type: must be equal to one of the allowed values')
  })
  it('requires nodata as a number, nan, inf, -inf or null', () => {
    for (const nodata of [0, -9999.5, 'nan', 'inf', '-inf', null]) passes(P, edit(aqm, d => { d.assets.cog.bands[0].nodata = nodata }))
    fails(P, edit(aqm, d => { d.assets.cog.bands[0].nodata = 'NaN' }), '/assets/cog/bands/0/nodata')
    fails(P, edit(aqm, d => delete d.assets.cog.bands[0].nodata), "must have required property 'nodata'")
  })
  it('requires count, min, max and integer buckets in a histogram', () => {
    fails(P, edit(cce, d => delete d.assets.cog['raster:bands'][0].histogram.count), "/assets/cog/raster:bands/0/histogram: must have required property 'count'")
    fails(P, edit(cce, d => { d.assets.cog['raster:bands'][0].histogram.buckets = [1.5] }), '/assets/cog/raster:bands/0/histogram/buckets/0')
  })
  it('types atlas:bidx (integer >= 1), atlas:rescale ([n, n] or auto) and atlas:colormap', () => {
    fails(P, edit(cce, d => { d.assets.cog['atlas:bidx'] = 0 }), '/assets/cog/atlas:bidx: must be >= 1')
    passes(P, edit(cce, d => { d.assets.cog['atlas:rescale'] = 'auto' }))
    fails(P, edit(cce, d => { d.assets.cog['atlas:rescale'] = 'fit' }), '/assets/cog/atlas:rescale')
    fails(P, edit(cce, d => { d.assets.cog['atlas:colormap'] = '' }), '/assets/cog/atlas:colormap')
  })
  it('leaves the bands of a non-data asset unchecked', () => {
    passes(P, edit(aqm, d => { d.assets.cog_005 = { href: './x.tif', type: d.assets.cog.type, roles: ['reference'], bands: [{ data_type: 'uint8' }] } }))
  })
})

// ---- h3 ----

describe('h3 rules', () => {
  const obis = fixture('h3', 'obis_h3_species_table')
  const twin = fixture('h3', 'hex_twin_res7')
  const P = 'h3'

  it('is a Collection', () => fails(P, edit(twin, d => { d.type = 'Feature' }), '/type'))
  it('lists unique resolutions, each 0 to 15, at least one', () => {
    passes(P, edit(twin, d => { d['h3:resolutions'] = [0, 15] }))
    fails(P, edit(twin, d => { d['h3:resolutions'] = [] }), '/h3:resolutions: must NOT have fewer than 1 items')
    fails(P, edit(twin, d => { d['h3:resolutions'] = [7, 7] }), '/h3:resolutions: must NOT have duplicate items')
    fails(P, edit(twin, d => { d['h3:resolutions'] = [-1] }), '/h3:resolutions/0')
  })
  it('names the cell column and its type, string or uint64', () => {
    fails(P, edit(twin, d => delete d['h3:cell_column']), "'h3:cell_column'")
    fails(P, edit(twin, d => { d['h3:cell_type'] = 'int64' }), '/h3:cell_type')
  })
  it('puts {res} in the layout template', () => fails(P, edit(twin, d => { d['h3:layout'].template = 'data.parquet' }), '/h3:layout/template: must match pattern'))
  it('puts {res} and {parent} in the parent template', () => {
    fails(P, edit(obis, d => { d['h3:layout'].parent_template = 'all/p={parent}/data_0.parquet' }), '/h3:layout/parent_template')
    fails(P, edit(obis, d => { d['h3:layout'].parent_template = 'all/res={res}/data_0.parquet' }), '/h3:layout/parent_template')
  })
  it('maps a resolution to a parent resolution in parent_res', () => {
    fails(P, edit(obis, d => { d['h3:layout'].parent_res = { six: 2 } }), '/h3:layout/parent_res')
    fails(P, edit(obis, d => { d['h3:layout'].parent_res = { '6': 2.5 } }), '/h3:layout/parent_res/6')
  })
  it('allows no other key in the layout', () => fails(P, edit(twin, d => { d['h3:layout'].root = '.' }), 'must NOT have additional properties: "root"'))
  it('gives periods a grain, values and a placeholder', () => {
    fails(P, edit(obis, d => { d['h3:periods'].grain = 'century' }), '/h3:periods/grain')
    fails(P, edit(obis, d => delete d['h3:periods'].placeholder), "/h3:periods: must have required property 'placeholder'")
  })
  it('requires table:columns with a name and a type each', () => {
    fails(P, edit(twin, d => delete d['table:columns']), "'table:columns'")
    fails(P, edit(twin, d => delete d['table:columns'][0].type), "/table:columns/0: must have required property 'type'")
  })
  it('requires href_template ({res}), resolutions, partition_by, columns and lookup in a species table', () => {
    for (const k of ['href_template', 'resolutions', 'partition_by', 'columns', 'lookup'])
      fails(P, edit(obis, d => delete d['h3:species_table'][k]), `/h3:species_table: must have required property '${k}'`)
    fails(P, edit(obis, d => { d['h3:species_table'].href_template = 'species/data_0.parquet' }), '/h3:species_table/href_template')
  })
  it('names the cell, species and count columns, and the lookup href, key and lineage column', () => {
    fails(P, edit(obis, d => delete d['h3:species_table'].columns.count), "/h3:species_table/columns: must have required property 'count'")
    fails(P, edit(obis, d => delete d['h3:species_table'].lookup.lineage_column), "/h3:species_table/lookup: must have required property 'lineage_column'")
  })
})

// ---- atlas-collection ----

describe('atlas-collection rules', () => {
  const eov = fixture('atlas-collection', 'aquamaps_eov_flower_cell_species')
  const cce = fixture('atlas-collection', 'cce_like_uncertainty')
  const P = 'atlas-collection'

  it('passes a collection with no atlas: field at all', () => passes(P, { type: 'Collection', stac_version: '1.1.0', id: 'x' }))
  it('types funders, access (restricted only) and note', () => {
    fails(P, edit(cce, d => { d['atlas:funders'] = 'BOEM' }), '/atlas:funders: must be array')
    fails(P, edit(cce, d => { d['atlas:access'] = 'public' }), '/atlas:access')
    fails(P, edit(cce, d => { d['atlas:note'] = ['a'] }), '/atlas:note')
  })
  it('gives atlas:flower exactly dimension and composite', () => {
    fails(P, edit(eov, d => delete d['atlas:flower'].dimension), "/atlas:flower: must have required property 'dimension'")
    fails(P, edit(eov, d => { d['atlas:flower'].label = 'x' }), 'must NOT have additional properties: "label"')
  })
  it('requires the cell_species lookup, layout tiles, tile_deg > 0, a {tile} template, the grid and the three columns', () => {
    for (const k of ['lookup_asset', 'layout', 'tile_deg', 'href_template', 'grid', 'key_column', 'species_column', 'value_column'])
      fails(P, edit(eov, d => delete d['atlas:cell_species'][k]), `/atlas:cell_species: must have required property '${k}'`)
    fails(P, edit(eov, d => { d['atlas:cell_species'].layout = 'single' }), '/atlas:cell_species/layout')
    fails(P, edit(eov, d => { d['atlas:cell_species'].tile_deg = 0 }), '/atlas:cell_species/tile_deg: must be > 0')
  })
  it('gives the cell_species grid ncol, nrow, res > 0 and x0, y0 numbers', () => {
    fails(P, edit(eov, d => { d['atlas:cell_species'].grid.res = 0 }), '/atlas:cell_species/grid/res')
    fails(P, edit(eov, d => delete d['atlas:cell_species'].grid.y0), "/atlas:cell_species/grid: must have required property 'y0'")
  })
  it('gives each cell_species link a label and a column or an href_template', () => {
    fails(P, edit(eov, d => { d['atlas:cell_species'].links.push({ label: 'nowhere' }) }), '/atlas:cell_species/links/4: must match a schema in anyOf')
    fails(P, edit(eov, d => { d['atlas:cell_species'].links[1].same_app = 'yes' }), '/atlas:cell_species/links/1/same_app')
  })
  it('requires total_column in a cell_species share', () => {
    fails(P, edit(eov, d => delete d['atlas:cell_species'].share.total_column), "/atlas:cell_species/share: must have required property 'total_column'")
  })
  it('requires the asset of a taxa registry', () => {
    passes(P, edit(eov, d => { d['atlas:taxa_registry'] = { asset: 'registry', key_column: 'sp_key', row_count: 3, search_columns: ['scientific_name'] } }))
    fails(P, edit(eov, d => { d['atlas:taxa_registry'] = { key_column: 'sp_key' } }), "/atlas:taxa_registry: must have required property 'asset'")
    fails(P, edit(eov, d => { d['atlas:taxa_registry'] = { asset: 'registry', row_count: 2.5 } }), '/atlas:taxa_registry/row_count')
  })
  it('names the dimension of a dimension uncertainty pair, not of a band pair', () => {
    fails(P, edit(cce, d => delete d['atlas:uncertainty'].dimension), "/atlas:uncertainty: must have required property 'dimension'")
    passes(P, edit(cce, d => { d['atlas:uncertainty'] = { pair: 'band', kind: 'se', mean: 1, uncertainty: 2 } }))
    fails(P, edit(cce, d => { d['atlas:uncertainty'].kind = 'iqr' }), '/atlas:uncertainty/kind')
    fails(P, edit(cce, d => { d['atlas:uncertainty'].mean = 1.5 }), '/atlas:uncertainty/mean')
  })
  it('labels cube dimension values with strings and flags the taxon dimension with a boolean', () => {
    fails(P, edit(cce, d => { d['cube:dimensions'].variable['atlas:labels'].cv = 2 }), '/cube:dimensions/variable/atlas:labels/cv')
    fails(P, edit(cce, d => { d['cube:dimensions'].species['atlas:taxon_dim'] = 'yes' }), '/cube:dimensions/species/atlas:taxon_dim')
  })
})

// ---- atlas-item ----

describe('atlas-item rules', () => {
  const item = fixture('atlas-item', 'aquamaps_eov_fish_share')
  const P = 'atlas-item'

  it('requires atlas:dims with at least one string value', () => {
    fails(P, edit(item, d => { d.properties['atlas:dims'] = {} }), '/properties/atlas:dims: must NOT have fewer than 1 properties')
    fails(P, edit(item, d => { d.properties['atlas:dims'].eov = 3 }), '/properties/atlas:dims/eov: must be string')
  })
  it('gives atlas:value_range as [n, n] and atlas:absent as a boolean', () => {
    fails(P, edit(item, d => { d.properties['atlas:value_range'] = [0] }), '/properties/atlas:value_range')
    fails(P, edit(item, d => { d.properties['atlas:absent'] = 'true' }), '/properties/atlas:absent')
  })
  it('gives atlas:rescale as [n, n] or auto', () => {
    passes(P, edit(item, d => { d.assets.cog['atlas:rescale'] = 'auto' }))
    fails(P, edit(item, d => { d.assets.cog['atlas:rescale'] = [0, '100'] }), '/assets/cog/atlas:rescale')
  })
  it('gives atlas:bidx as an integer >= 1', () => {
    fails(P, edit(item, d => { d.assets.cog['atlas:bidx'] = 1.5 }), '/assets/cog/atlas:bidx: must be integer')
  })
  it('types the values join keys as strings and sdm:h3_resolution as 0 to 15', () => {
    fails(P, edit(item, d => { d.assets.cog['atlas:key_column'] = 1 }), '/assets/cog/atlas:key_column')
    fails(P, edit(item, d => { d.assets.cog['sdm:h3_resolution'] = 16 }), '/assets/cog/sdm:h3_resolution')
  })
})

// ---- sdm-dossier ----

describe('sdm-dossier rules', () => {
  const rich = fixture('sdm-dossier', 'richness_item_evaluation_curves')
  const multi = fixture('sdm-dossier', 'multi_species_collection')
  const P = 'sdm-dossier'

  it('reads sdm:response_type from the 1.0.0 values plus richness and uncertainty', () => {
    for (const t of ['occurrence', 'mixed', 'richness', 'uncertainty']) passes(P, edit(rich, d => { d.properties['sdm:response_type'] = t }))
    fails(P, edit(multi, d => { d['sdm:response_type'] = 'abundance' }), '/sdm:response_type')
  })
  it('reads the fields from properties on an Item and from the top level on a Collection', () => {
    fails(P, edit(rich, d => { Object.assign(d, d.properties); d.properties = { datetime: null } }), "/properties: must have required property 'sdm:response_type'")
    fails(P, edit(multi, d => { d.properties = { 'sdm:response_type': 'richness' }; delete d['sdm:response_type'] }), "/: must have required property 'sdm:response_type'")
  })
  it('requires the four 1.0.0 core descriptors', () => {
    for (const k of ['sdm:response_type', 'sdm:method', 'sdm:source_authority', 'sdm:temporal_interval'])
      fails(P, edit(multi, d => delete d[k]), `'${k}'`)
  })
  it('gives each of sdm:taxa a scientific name, known authorities and a Red List code', () => {
    fails(P, edit(multi, d => delete d['sdm:taxa'][0].scientific_name), "/sdm:taxa/0: must have required property 'scientific_name'")
    fails(P, edit(multi, d => { d['sdm:taxa'][0].authorities.obis = 1 }), '/sdm:taxa/0/authorities')
    fails(P, edit(multi, d => { d['sdm:taxa'][0].redlist_code = 'XX' }), '/sdm:taxa/0/redlist_code')
  })
  it('does not allow sdm:taxon and sdm:taxa together', () => {
    fails(P, edit(multi, d => { d['sdm:taxon'] = { scientific_name: 'Alopias vulpinus' } }), '/: must NOT be valid (sdm:taxon (one taxon) and sdm:taxa')
  })
  it('allows sdm:taxon.group as a string or a boolean', () => {
    const single = edit(rich, d => { d.properties['sdm:taxon'] = { scientific_name: 'Alopias vulpinus', authorities: { worms: 105836 } } })
    passes(P, edit(single, d => { d.properties['sdm:taxon'].group = 'shark' }))
    passes(P, edit(single, d => { d.properties['sdm:taxon'].group = true }))
  })
  it('reads sdm:aggregation.method from mean, sum, max, min, richness, share, composite', () => {
    fails(P, edit(multi, d => { d['sdm:aggregation'].method = 'ecoregion_weighted' }), '/sdm:aggregation/method')
    fails(P, edit(multi, d => { d['sdm:aggregation'].group = 'shark' }), 'must NOT have additional properties: "group"')
  })
  it('requires at least one evaluation metric with a name and a value', () => {
    fails(P, edit(rich, d => delete d.properties['sdm:evaluation'].metrics), "/properties/sdm:evaluation: must have required property 'metrics'")
    fails(P, edit(rich, d => { d.properties['sdm:evaluation'].metrics[0].partition = 'holdout' }), '/properties/sdm:evaluation/metrics/0/partition')
  })
  it('leaves the equal length of roc fpr and tpr to the reader', () => {
    passes(P, edit(rich, d => { d.properties['sdm:evaluation'].roc.tpr = [0, 1] }))
  })
  it('requires predictor, x and y in a response curve', () => {
    for (const k of ['predictor', 'x', 'y']) fails(P, edit(rich, d => delete d.properties['sdm:response_curves'][0][k]), `'${k}'`)
    fails(P, edit(rich, d => { d.properties['sdm:response_curves'][0].x = ['20'] }), '/properties/sdm:response_curves/0/x/0')
  })
})

// ---- values-row ----

describe('values-row rules', () => {
  const cont = fixture('values-row', 'continuous')
  const all = fixture('values-row', 'all-grain')
  const P = 'values-row'

  it('requires the nine 1.1 columns and leaves sd optional (a 1.1 row has none)', () => {
    for (const k of ['place_id', 'coll', 'indicator', 'time_grain', 'time', 'class', 'value', 'n', 'unit'])
      fails(P, edit(cont, d => delete d[k]), `'${k}'`)
    passes(P, edit(cont, d => delete d.sd))
  })
  it('names a place as <authority>:<source_id>', () => {
    fails(P, edit(cont, d => { d.place_id = 'NMS: CINMS' }), '/place_id: must match pattern')
  })
  it('reads the indicator id as <family>:<parts>', () => {
    for (const id of ['sdg:ER_MRN_MPA', 'obis:sp:seaTurtles', 'cmems:cmems_obs-oc:CHL:mean']) passes(P, edit(cont, d => { d.indicator = id }))
    fails(P, edit(cont, d => { d.indicator = 'SST mean' }), '/indicator: must match pattern')
  })
  it('reads time_grain from all, decade, year, month, day', () => {
    fails(P, edit(cont, d => { d.time_grain = 'week' }), '/time_grain: must be equal to one of the allowed values: "all", "decade", "year", "month", "day"')
  })
  it('gives time as null exactly when time_grain is all', () => {
    fails(P, edit(all, d => { d.time = '2020-01-01' }), '/time: must be null')
    fails(P, edit(cont, d => { d.time = null }), '/time: must be string')
    fails(P, edit(cont, d => { d.time = '2020-7-1' }), '/time: must match pattern')
  })
  it('keeps sd and n at or above 0, or null', () => {
    fails(P, edit(cont, d => { d.sd = -0.5 }), '/sd: must be >= 0')
    passes(P, edit(cont, d => { d.sd = null; d.n = null }))
  })
  it('lets only x_* extra columns through', () => {
    passes(P, edit(cont, d => { d.x_m49 = 56 }))
    fails(P, edit(cont, d => { d.basis = 'territory' }), 'must NOT have additional properties: "basis"')
  })
})

// ---- values-provenance ----

describe('values-provenance rules', () => {
  const v12 = fixture('values-provenance', 'v12-erddap')
  const v11 = fixture('values-provenance', 'v11-without-dataset')
  const P = 'values-provenance'

  it('reads contract as a 1.x semver', () => {
    fails(P, edit(v11, d => { d.contract = '2.0.0' }), '/contract: must match pattern')
    fails(P, edit(v11, d => { d.contract = '1.1' }), '/contract: must match pattern')
  })
  it('requires dataset from contract 1.2 on, not before', () => {
    for (const c of ['1.2.0', '1.3.1']) fails(P, edit(v12, d => { d.contract = c; delete d.dataset }), "/: must have required property 'dataset'")
    for (const c of ['1.0.0', '1.1.9']) passes(P, edit(v11, d => { d.contract = c }))
  })
  it('gives a source an href, a STAC item url or null, and a role', () => {
    fails(P, edit(v12, d => delete d.sources[0].href), "/sources/0: must have required property 'href'")
    fails(P, edit(v12, d => { d.sources[0].item = 7 }), '/sources/0/item: must be string,null')
    for (const r of ['data', 'geometry', 'product', 'manifest']) passes(P, edit(v12, d => { d.sources[1].role = r }))
  })
  it('stamps created to the second in UTC and keeps method a sentence', () => {
    fails(P, edit(v12, d => { d.created = '2026-10-20' }), '/created: must match pattern')
    fails(P, edit(v12, d => { d.method = 'mean' }), '/method: must NOT have fewer than 10 characters')
  })
  it('allows no extra key at the top level or in dataset', () => {
    fails(P, edit(v12, d => { d.notes = 'x' }), 'must NOT have additional properties: "notes"')
    fails(P, edit(v12, d => { d.dataset.url = 'x' }), '/dataset: must NOT have additional properties: "url"')
  })
})

// ---- the command line ----

describe('om-catalog', () => {
  const lines = () => {
    const out: string[] = []
    const err: string[] = []
    return { out, err, o: (s: string) => out.push(s), e: (s: string) => err.push(s) }
  }
  const f = (profile: string, kind: string, file: string) => join(FIXTURES, profile, kind, file)

  it('lists the profiles', () => {
    const l = lines()
    expect(run(['profiles'], l.o, l.e)).toBe(0)
    expect(l.out).toEqual(listProfiles())
  })
  it('exits 0 when every file is valid', () => {
    const l = lines()
    expect(run(['validate', 'h3', f('h3', 'valid', 'hex_twin_res7.json'), f('h3', 'valid', 'obis_h3_species_table.json')], l.o, l.e)).toBe(0)
    expect(l.out.at(-1)).toBe('2 of 2 valid against h3')
  })
  it('exits 1 and prints the errors when a file fails', () => {
    const l = lines()
    expect(run(['validate', 'h3', f('h3', 'valid', 'hex_twin_res7.json'), f('h3', 'invalid', 'resolution_16.json')], l.o, l.e)).toBe(1)
    expect(l.err.join('\n')).toContain('/h3:resolutions/1: must be <= 15')
  })
  it('exits 2 with the usage line on a bad command or an unknown profile', () => {
    const l = lines()
    expect(run(['check'], l.o, l.e)).toBe(2)
    expect(l.err).toEqual([USAGE])
    expect(run(['validate', 'nope', 'x.json'], l.o, l.e)).toBe(2)
  })
})
