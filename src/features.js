// Parse ALL [key=value] tags from messages and headers
// Not just think/search — ANY tag. Sandbox code decides what they mean.

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
      var val = parts[i].slice(eqIdx + 1).trim();
      if (key) features[key] = val;
    }
  }

  // 2. Scan messages for ALL [key=value] tags
  //    Message tags override header values
  if (body && Array.isArray(body.messages)) {
    for (var m = 0; m < body.messages.length; m++) {
      var msg = body.messages[m];
      if (typeof msg.content !== 'string') continue;

      var tagRegex = /\[([a-zA-Z_][a-zA-Z0-9_]*)=([^\]]+)\]/gi;
      var match;
      while ((match = tagRegex.exec(msg.content)) !== null) {
        features[match[1].toLowerCase()] = match[2].trim();
      }

      // Strip ALL [key=value] tags from content
      body.messages[m].content = msg.content.replace(/\[[a-zA-Z_][a-zA-Z0-9_]*=[^\]]+\]/gi, '').trim();
    }
  }

  return features;
}

// Apply think_config to body for unhandled think feature
export function applyThinkConfig(body, thinkValue, thinkConfig) {
  if (!thinkConfig || !thinkValue) return;

  if (thinkValue === 'off' && thinkConfig.modes && thinkConfig.modes.off === null) {
    var paramPath = thinkConfig.param_path || 'thinking_config';
    delete body[paramPath];
    return;
  }

  if (thinkConfig.modes && thinkConfig.modes[thinkValue]) {
    var paramPath2 = thinkConfig.param_path || 'thinking_config';
    body[paramPath2] = JSON.parse(JSON.stringify(thinkConfig.modes[thinkValue]));
    return;
  }

  var numVal = Number(thinkValue);
  if (!isNaN(numVal) && thinkConfig.numeric_field) {
    var paramPath3 = thinkConfig.param_path || 'thinking_config';
    body[paramPath3] = {};
    body[paramPath3][thinkConfig.numeric_field] = numVal;
    return;
  }

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
    if (injection === null) return;
    for (var key in injection) {
      if (Array.isArray(injection[key]) && Array.isArray(body[key])) {
        body[key] = body[key].concat(injection[key]);
      } else {
        body[key] = JSON.parse(JSON.stringify(injection[key]));
      }
    }
  }
}
