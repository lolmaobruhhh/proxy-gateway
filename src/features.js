// Parse [think=...] and [search=...] tags from messages and headers
// Returns features object AND modifies body.messages in-place (strips tags)

export function parseFeatures(body, headers) {
  var features = {};

  // 1. Check x-proxy-features header
  var headerVal = '';
  if (headers && headers['x-proxy-features']) {
    headerVal = headers['x-proxy-features'];
  }
  if (headerVal) {
    var parts = headerVal.split(';');
    for (var i = 0; i < parts.length; i++) {
      var eqIdx = parts[i].indexOf('=');
      if (eqIdx === -1) continue;
      var key = parts[i].slice(0, eqIdx).trim().toLowerCase();
      var val = parts[i].slice(eqIdx + 1).trim().toLowerCase();
      if (key === 'think' || key === 'search') {
        features[key] = val;
      }
    }
  }

  // 2. Scan messages for [think=...] and [search=...] tags
  //    Message tags override header values
  if (body && Array.isArray(body.messages)) {
    for (var m = 0; m < body.messages.length; m++) {
      var msg = body.messages[m];
      if (typeof msg.content !== 'string') continue;

      // Find all tags
      var tagRegex = /\[(think|search)=([^\]]+)\]/gi;
      var match;
      while ((match = tagRegex.exec(msg.content)) !== null) {
        features[match[1].toLowerCase()] = match[2].trim().toLowerCase();
      }

      // Strip tags from content
      body.messages[m].content = msg.content.replace(/\[(think|search)=[^\]]+\]/gi, '').trim();
    }
  }

  return features;
}

// Apply think_config to body for unhandled think feature
export function applyThinkConfig(body, thinkValue, thinkConfig) {
  if (!thinkConfig || !thinkValue) return;

  // "off" means remove thinking
  if (thinkValue === 'off' && thinkConfig.modes && thinkConfig.modes.off === null) {
    var paramPath = thinkConfig.param_path || 'thinking_config';
    delete body[paramPath];
    return;
  }

  // Check named modes first
  if (thinkConfig.modes && thinkConfig.modes[thinkValue]) {
    var paramPath2 = thinkConfig.param_path || 'thinking_config';
    body[paramPath2] = JSON.parse(JSON.stringify(thinkConfig.modes[thinkValue]));
    return;
  }

  // Check numeric value
  var numVal = Number(thinkValue);
  if (!isNaN(numVal) && thinkConfig.numeric_field) {
    var paramPath3 = thinkConfig.param_path || 'thinking_config';
    body[paramPath3] = {};
    body[paramPath3][thinkConfig.numeric_field] = numVal;
    return;
  }

  // Default to "on" mode if exists
  if (thinkConfig.modes && thinkConfig.modes.on) {
    var paramPath4 = thinkConfig.param_path || 'thinking_config';
    body[paramPath4] = JSON.parse(JSON.stringify(thinkConfig.modes.on));
  }
}

// Apply search_config to body for unhandled search feature
export function applySearchConfig(body, searchValue, searchConfig) {
  if (!searchConfig || !searchValue) return;

  if (searchConfig.inject && searchConfig.inject[searchValue] !== undefined) {
    var injection = searchConfig.inject[searchValue];
    if (injection === null) {
      // "off" — remove search tools if we know how
      return;
    }
    // Merge injection into body
    for (var key in injection) {
      if (Array.isArray(injection[key]) && Array.isArray(body[key])) {
        // Append to existing array
        body[key] = body[key].concat(injection[key]);
      } else {
        body[key] = JSON.parse(JSON.stringify(injection[key]));
      }
    }
  }
}
