// Audio filters for the music player. Filters are applied by re-encoding
// the current track through FFmpeg (prism-media) — so applying a filter
// restarts the current track from the beginning with the filter on. That
// is stated honestly in the README: filters can't be applied mid-stream
// to an already-playing Opus resource without re-encoding.
const FILTERS = {
  off: null,
  bassboost: 'bass=g=10:f=110',
  nightcore: 'asetrate=48000*1.25,aresample=48000,atempo=1.0',
  vaporwave: 'asetrate=48000*0.8,aresample=48000,atempo=1.0',
  '8d': 'apulsator=hz=0.125',
};

function isValidFilter(name) {
  return Object.prototype.hasOwnProperty.call(FILTERS, name);
}

function filterArgs(name) {
  return FILTERS[name] || null;
}

function listFilters() {
  return Object.keys(FILTERS);
}

module.exports = { FILTERS, isValidFilter, filterArgs, listFilters };
