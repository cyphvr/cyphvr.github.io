const OK = 'ok';
const WARN = 'warn';
const ALERT = 'alert';
const NO_DATA = 'no_data';

const RANK = { [OK]: 0, [NO_DATA]: 1, [WARN]: 2, [ALERT]: 3 };
const CHECK_STATUS = { [OK]: 0, [WARN]: 1, [ALERT]: 2, [NO_DATA]: 3 };
const OVERALL_STATE = { [OK]: 'OK', [WARN]: 'Warn', [ALERT]: 'Alert', [NO_DATA]: 'No Data' };

const RENOTIFY_MS = 30 * 60 * 1000;
const HISTORY_LIMIT = 30;
const WINDOW_LIMIT = 5;
const EVENT_LIMIT = 50;
const STATE_KEY = 'monitor_state_v2';
const BOT_CHECK_URL = 'http://cypher.hype.surf:10001';
const DISCORD_STATUS_URL = 'https://discordstatus.com/api/v2/summary.json';
const DISCORD_API_URL = 'https://discord.com/api/v10/users/@me';
const CHECK_TIMEOUT_MS = 8000;
const SYNTHETICS_RETRIES = 2;
const SYNTHETICS_RETRY_MS = 300;

const DEFAULT_TAGS = ['env:prod', 'service:cypher', 'team:cypher'];

const MONITOR_DEFS = {
  'bot.health': {
    id: 'bot.health',
    name: 'Bot process health',
    type: 'synthetics alert',
    query: `GET ${BOT_CHECK_URL}. Synthetics HTTP. Alert after 3 consecutive CRITICAL. Recover after 2 OK.`,
    tags: [...DEFAULT_TAGS, 'monitor:bot.health'],
    priority: 1,
    alertAfter: 3,
    warnAfter: 2,
    recoverAfter: 2,
    noDataAfter: 3,
    noDataBehavior: 'show_and_notify',
    notifyOnWarn: false,
    notifyOnNoData: false,
    page: false,
    options: {
      thresholds: { critical: 3, warning: 2, ok: 2 },
      notify_no_data: false,
      notify_audit: false,
      timeout_h: 0,
      require_full_window: true,
      renotify_interval: 30,
      renotify_statuses: ['alert'],
      on_missing_data: 'show_and_notify',
      evaluation_delay: 0,
      silenced: {},
    },
  },
  'discord.api': {
    id: 'discord.api',
    name: 'Discord REST API',
    type: 'synthetics alert',
    query: `GET ${DISCORD_API_URL}. Synthetics HTTP. 429=WARN. 5xx/auth=CRITICAL. Alert after 3 consecutive.`,
    tags: [...DEFAULT_TAGS, 'monitor:discord.api'],
    priority: 1,
    alertAfter: 3,
    warnAfter: 3,
    recoverAfter: 2,
    noDataAfter: 3,
    noDataBehavior: 'show_and_notify',
    notifyOnWarn: true,
    notifyOnNoData: false,
    page: false,
    options: {
      thresholds: { critical: 3, warning: 3, ok: 2 },
      notify_no_data: false,
      timeout_h: 0,
      require_full_window: true,
      renotify_interval: 30,
      renotify_statuses: ['alert'],
      on_missing_data: 'show_and_notify',
      evaluation_delay: 0,
      silenced: {},
    },
  },
  'discord.status': {
    id: 'discord.status',
    name: 'Discord platform status',
    type: 'synthetics alert',
    query: `GET ${DISCORD_STATUS_URL} grouped by API,Gateway. Alert after 2 consecutive. Missing data: last known.`,
    tags: [...DEFAULT_TAGS, 'monitor:discord.status'],
    priority: 2,
    alertAfter: 2,
    warnAfter: 2,
    recoverAfter: 2,
    noDataAfter: 3,
    noDataBehavior: 'show_last_known',
    notifyOnWarn: true,
    notifyOnNoData: false,
    page: false,
    options: {
      thresholds: { critical: 2, warning: 2, ok: 2 },
      notify_no_data: false,
      timeout_h: 0,
      require_full_window: true,
      renotify_interval: 30,
      renotify_statuses: ['alert'],
      on_missing_data: 'show_last_known',
      evaluation_delay: 0,
      silenced: {},
    },
  },
};

const MONITOR_ORDER = ['bot.health', 'discord.api', 'discord.status'];

const COMPOSITE_DEFS = {
  'composite.page.bot': {
    id: 'composite.page.bot',
    name: 'Bot outage (Discord not alert-worthy)',
    type: 'composite',
    query: 'bot.health && !discord.api && !discord.status',
    all: ['bot.health'],
    none: ['discord.api', 'discord.status'],
    page: true,
    priority: 1,
    tags: [...DEFAULT_TAGS, 'composite:page.bot'],
  },
  'composite.page.discord': {
    id: 'composite.page.discord',
    name: 'Discord dependency',
    type: 'composite',
    query: 'discord.api || discord.status',
    any: ['discord.api', 'discord.status'],
    page: true,
    priority: 2,
    tags: [...DEFAULT_TAGS, 'composite:page.discord'],
  },
};

const COMPOSITE_ORDER = ['composite.page.bot', 'composite.page.discord'];

const PAGING_COMPONENTS = new Set(['API', 'Gateway']);

const COMPONENT_STATUS_RANK = {
  operational: RANK[OK],
  degraded_performance: RANK[WARN],
  under_maintenance: RANK[WARN],
  partial_outage: RANK[ALERT],
  major_outage: RANK[ALERT],
};

const INDICATOR_RANK = {
  none: RANK[OK],
  minor: RANK[WARN],
  major: RANK[ALERT],
  critical: RANK[ALERT],
};

const IMPACT_RANK = {
  none: RANK[OK],
  maintenance: RANK[WARN],
  minor: RANK[WARN],
  major: RANK[ALERT],
  critical: RANK[ALERT],
};

const EMBED_COLORS = {
  [ALERT]: 16732280,
  [WARN]: 16763936,
  [OK]: 2596420,
  [NO_DATA]: 8421504,
};

function statusFromRank(rank) {
  if (rank >= RANK[ALERT]) return ALERT;
  if (rank >= RANK[WARN]) return WARN;
  if (rank >= RANK[NO_DATA]) return NO_DATA;
  return OK;
}

function isAlertWorthy(state) {
  return Boolean(state) && state.status !== OK;
}

function emptyConsecutive() {
  return { ok: 0, warn: 0, alert: 0, no_data: 0 };
}

function newMonitorState(id) {
  return {
    id,
    status: OK,
    lastSampleStatus: OK,
    checkStatus: CHECK_STATUS[OK],
    consecutive: emptyConsecutive(),
    lastTransitionAt: 0,
    lastTriggeredAt: 0,
    lastEvalAt: 0,
    message: '',
    details: [],
    fingerprint: 'ok',
    muted: false,
    muteReason: null,
    history: [],
    window: [],
    responseTime: null,
    httpStatus: null,
    attempts: 1,
  };
}

function newCompositeState(id) {
  return {
    id,
    status: OK,
    lastTransitionAt: 0,
    lastTriggeredAt: 0,
  };
}

function emptyStore() {
  return {
    version: 2,
    monitors: Object.fromEntries(MONITOR_ORDER.map((id) => [id, newMonitorState(id)])),
    composites: Object.fromEntries(COMPOSITE_ORDER.map((id) => [id, newCompositeState(id)])),
    case: null,
    events: [],
  };
}

function bumpConsecutive(prev, sampleStatus) {
  const consecutive = emptyConsecutive();
  const key = sampleStatus in consecutive ? sampleStatus : NO_DATA;
  consecutive[key] = (prev.consecutive?.[key] || 0) + 1;
  return consecutive;
}

function sampleForEvaluation(def, prev, sample) {
  if (sample.status !== NO_DATA) return sample;
  if (def.noDataBehavior === 'show_last_known' && prev.lastEvalAt && prev.status !== NO_DATA) {
    return {
      ...sample,
      status: prev.status,
      message: prev.message || sample.message,
      details: prev.details?.length ? prev.details : sample.details,
      fingerprint: prev.fingerprint,
      heldLastKnown: true,
    };
  }
  if (def.noDataBehavior === 'show_and_notify' || def.noDataBehavior === 'alert') {
    return { ...sample, status: ALERT, fingerprint: sample.fingerprint || 'no_data' };
  }
  if (def.noDataBehavior === 'resolve' || def.noDataBehavior === 'ok') {
    return { ...sample, status: OK, fingerprint: 'ok' };
  }
  return sample;
}

function applySample(def, prevState, rawSample, now) {
  const prev = prevState || newMonitorState(def.id);
  const sample = sampleForEvaluation(
    def,
    prev,
    rawSample || { status: NO_DATA, message: 'No sample', fingerprint: 'no_data', details: [] }
  );
  const consecutive = bumpConsecutive(prev, sample.status);

  let nextStatus = prev.status;

  if (prev.status === OK) {
    if (sample.status === ALERT && consecutive.alert >= def.alertAfter) nextStatus = ALERT;
    else if (sample.status === WARN && consecutive.warn >= def.warnAfter) nextStatus = WARN;
    else if (sample.status === NO_DATA && consecutive.no_data >= def.noDataAfter) nextStatus = NO_DATA;
  } else if (prev.status === WARN) {
    if (sample.status === ALERT && consecutive.alert >= def.alertAfter) nextStatus = ALERT;
    else if (sample.status === OK && consecutive.ok >= def.recoverAfter) nextStatus = OK;
    else if (sample.status === NO_DATA && consecutive.no_data >= def.noDataAfter) nextStatus = NO_DATA;
  } else if (prev.status === ALERT) {
    if (sample.status === OK && consecutive.ok >= def.recoverAfter) nextStatus = OK;
    else if (sample.status === WARN && consecutive.warn >= def.recoverAfter) nextStatus = WARN;
    else if (
      sample.status === NO_DATA &&
      def.noDataBehavior !== 'show_last_known' &&
      consecutive.no_data >= def.noDataAfter
    ) {
      nextStatus = NO_DATA;
    }
  } else if (prev.status === NO_DATA) {
    if (sample.status === OK && consecutive.ok >= def.recoverAfter) nextStatus = OK;
    else if (sample.status === ALERT && consecutive.alert >= def.alertAfter) nextStatus = ALERT;
    else if (sample.status === WARN && consecutive.warn >= def.warnAfter) nextStatus = WARN;
  }

  const point = {
    t: now,
    sample: sample.status,
    status: nextStatus,
    checkStatus: CHECK_STATUS[sample.status] ?? 3,
    responseTime: sample.responseTime ?? null,
    httpStatus: sample.httpStatus ?? null,
  };

  return {
    id: def.id,
    status: nextStatus,
    lastSampleStatus: rawSample?.status || NO_DATA,
    checkStatus: CHECK_STATUS[nextStatus],
    consecutive,
    lastTransitionAt: nextStatus !== prev.status ? now : prev.lastTransitionAt,
    lastTriggeredAt:
      nextStatus === ALERT && prev.status !== ALERT ? now : prev.lastTriggeredAt || 0,
    lastEvalAt: now,
    message: sample.message || '',
    details: Array.isArray(sample.details) ? sample.details : [],
    fingerprint: sample.fingerprint || nextStatus,
    muted: false,
    muteReason: null,
    history: [...(prev.history || []), point].slice(-HISTORY_LIMIT),
    window: [...(prev.window || []), point].slice(-WINDOW_LIMIT),
    responseTime: sample.responseTime ?? null,
    httpStatus: sample.httpStatus ?? null,
    attempts: sample.attempt || sample.attempts || 1,
    heldLastKnown: Boolean(sample.heldLastKnown),
    transition: nextStatus !== prev.status ? `${prev.status}->${nextStatus}` : null,
  };
}

function applyAll(prevMonitors, samples, now) {
  const states = {};
  for (const id of MONITOR_ORDER) {
    states[id] = applySample(MONITOR_DEFS[id], prevMonitors?.[id], samples[id], now);
  }
  return states;
}

function evalComposite(def, states) {
  if (def.all && !def.all.every((id) => isAlertWorthy(states[id]))) return OK;
  if (def.none && !def.none.every((id) => !isAlertWorthy(states[id]))) return OK;
  if (def.any && !def.any.some((id) => isAlertWorthy(states[id]))) return OK;

  let rank = RANK[OK];
  for (const id of [...(def.all || []), ...(def.any || [])]) {
    rank = Math.max(rank, RANK[states[id]?.status] || 0);
  }
  return statusFromRank(rank);
}

function applyComposites(monitorStates, prevComposites, now) {
  const next = {};
  for (const id of COMPOSITE_ORDER) {
    const def = COMPOSITE_DEFS[id];
    const status = evalComposite(def, monitorStates);
    const prev = prevComposites?.[id] || newCompositeState(id);
    next[id] = {
      id,
      name: def.name,
      type: 'composite',
      query: def.query,
      status,
      checkStatus: CHECK_STATUS[status],
      lastTransitionAt: status !== prev.status ? now : prev.lastTransitionAt,
      lastTriggeredAt: status === ALERT && prev.status !== ALERT ? now : prev.lastTriggeredAt || 0,
      transition: status !== prev.status ? `${prev.status}->${status}` : null,
      priority: def.priority,
      tags: def.tags,
    };
  }
  return next;
}

function annotateMute(states, compositeStates) {
  const next = {};
  for (const [id, state] of Object.entries(states)) {
    next[id] = { ...state, muted: false, muteReason: null };
  }
  const discordComposite = compositeStates['composite.page.discord'];
  if (isAlertWorthy(discordComposite) && isAlertWorthy(next['bot.health'])) {
    next['bot.health'] = {
      ...next['bot.health'],
      muted: true,
      muteReason: 'Muted by composite.page.discord (Datadog downstream mute)',
    };
  }
  return next;
}

function pagingSeverity(compositeStates) {
  let maxRank = RANK[OK];
  for (const id of COMPOSITE_ORDER) {
    const def = COMPOSITE_DEFS[id];
    if (!def.page) continue;
    maxRank = Math.max(maxRank, RANK[compositeStates[id]?.status] || 0);
  }
  return statusFromRank(maxRank);
}

function overallStatus(states, compositeStates) {
  let maxRank = RANK[OK];
  for (const state of Object.values(states)) maxRank = Math.max(maxRank, RANK[state.status] || 0);
  for (const state of Object.values(compositeStates || {})) {
    maxRank = Math.max(maxRank, RANK[state.status] || 0);
  }
  return statusFromRank(maxRank);
}

function notifyFingerprint(states, compositeStates) {
  const monitors = MONITOR_ORDER.map((id) => {
    const state = states[id];
    if (!state || state.status === OK) return null;
    return `${id}=${state.status}${state.muted ? '@muted' : ''}/${state.fingerprint}`;
  });
  const composites = COMPOSITE_ORDER.map((id) => {
    const state = compositeStates[id];
    if (!state || state.status === OK) return null;
    return `${id}=${state.status}`;
  });
  return [...monitors, ...composites].filter(Boolean).join('|');
}

function displayFingerprint(states, compositeStates) {
  const monitors = MONITOR_ORDER.map((id) => {
    const state = states[id];
    if (!state || state.status === OK) return null;
    return `${id}=${state.status}:${state.message}:${JSON.stringify(state.details)}`;
  });
  const composites = COMPOSITE_ORDER.map((id) => {
    const state = compositeStates[id];
    if (!state || state.status === OK) return null;
    return `${id}=${state.status}`;
  });
  return [...monitors, ...composites].filter(Boolean).join('|');
}

function newCaseId(now) {
  return `CYPH-${now.toString(36).toUpperCase()}`;
}

function caseTitle(severity, states, compositeStates) {
  const firingComposites = COMPOSITE_ORDER.map((id) => compositeStates[id]).filter(
    (s) => s && s.status !== OK && RANK[s.status] >= RANK[severity === ALERT ? ALERT : WARN]
  );
  if (firingComposites.length) return firingComposites.map((s) => s.name).join(', ');
  const firing = MONITOR_ORDER.map((id) => states[id]).filter((s) => s && s.status !== OK && !s.muted);
  if (firing.length) return firing.map((s) => MONITOR_DEFS[s.id]?.name || s.id).join(', ');
  return 'Monitor event';
}

function planNotifications({ states, compositeStates, prevCase, now, renotifyMs = RENOTIFY_MS }) {
  const severity = pagingSeverity(compositeStates);
  const nfp = notifyFingerprint(states, compositeStates);
  const dfp = displayFingerprint(states, compositeStates);
  const title = caseTitle(severity === OK ? WARN : severity, states, compositeStates);

  if (severity === OK) {
    if (prevCase?.status === 'open') {
      return {
        action: 'resolve',
        ping: false,
        eventType: 'recovered',
        case: {
          ...prevCase,
          status: 'open',
          severity: OK,
          fingerprint: '',
          displayFingerprint: '',
          title: 'All monitors OK',
          resolvedAt: now,
        },
      };
    }
    return { action: 'none', ping: false, eventType: null, case: prevCase };
  }

  if (!prevCase || prevCase.status !== 'open') {
    return {
      action: 'open',
      ping: severity === ALERT,
      eventType: severity === ALERT ? 'triggered' : 'warn',
      case: {
        id: newCaseId(now),
        status: 'open',
        severity,
        fingerprint: nfp,
        displayFingerprint: dfp,
        title,
        openedAt: now,
        resolvedAt: null,
        lastNotifiedAt: 0,
        lastRenotifyAt: 0,
        discordMessageId: null,
        followupMessageIds: [],
        events: [],
      },
    };
  }

  const neverNotified = !prevCase.lastNotifiedAt && !prevCase.discordMessageId;
  if (neverNotified) {
    return {
      action: 'open',
      ping: severity === ALERT,
      eventType: severity === ALERT ? 'triggered' : 'warn',
      case: {
        ...prevCase,
        severity,
        fingerprint: nfp,
        displayFingerprint: dfp,
        title,
        resolvedAt: null,
      },
    };
  }

  const prevRank = RANK[prevCase.severity] || 0;
  const nextRank = RANK[severity];
  if (nextRank > prevRank) {
    return {
      action: 'escalate',
      ping: severity === ALERT,
      eventType: 'triggered',
      case: { ...prevCase, severity, fingerprint: nfp, displayFingerprint: dfp, title },
    };
  }

  const lastPingAt = prevCase.lastRenotifyAt || prevCase.lastNotifiedAt || prevCase.openedAt || 0;
  if (severity === ALERT && now - lastPingAt >= renotifyMs) {
    return {
      action: 'renotify',
      ping: true,
      eventType: 'renotify',
      case: { ...prevCase, severity, fingerprint: nfp, displayFingerprint: dfp, title },
    };
  }

  if (nfp !== prevCase.fingerprint || dfp !== prevCase.displayFingerprint) {
    return {
      action: 'update',
      ping: false,
      eventType: null,
      case: { ...prevCase, severity, fingerprint: nfp, displayFingerprint: dfp, title },
    };
  }

  return { action: 'none', ping: false, eventType: null, case: prevCase };
}

function evaluateTick({ store, samples, now, renotifyMs = RENOTIFY_MS }) {
  const applied = applyAll(store?.monitors, samples, now);
  const compositeStates = applyComposites(applied, store?.composites, now);
  const states = annotateMute(applied, compositeStates);
  const plan = planNotifications({
    states,
    compositeStates,
    prevCase: store?.case,
    now,
    renotifyMs,
  });
  return {
    monitors: states,
    composites: compositeStates,
    overall: overallStatus(states, compositeStates),
    paging: pagingSeverity(compositeStates),
    plan,
  };
}

function interpretBotHealth({ httpStatus, body, error }) {
  if (error) {
    return {
      status: ALERT,
      message: `Bot status check failed: ${error}`,
      fingerprint: 'error',
      details: [{ code: 'error', error: String(error) }],
    };
  }
  if (!httpStatus || httpStatus >= 500) {
    return {
      status: ALERT,
      message: `Bot status endpoint HTTP ${httpStatus || 'unknown'}`,
      fingerprint: `http:${httpStatus || 'unknown'}`,
      details: [{ code: 'http', status: httpStatus }],
    };
  }
  if (httpStatus !== 200) {
    return {
      status: ALERT,
      message: `Bot status endpoint HTTP ${httpStatus}`,
      fingerprint: `http:${httpStatus}`,
      details: [{ code: 'http', status: httpStatus }],
    };
  }
  if (body && body.success === true) {
    return {
      status: OK,
      message: 'Bot process reporting healthy',
      fingerprint: 'ok',
      details: [],
    };
  }
  return {
    status: ALERT,
    message: 'Bot process is not reporting healthy (success ≠ true)',
    fingerprint: 'unhealthy',
    details: [{ code: 'unhealthy' }],
  };
}

function interpretDiscordApi({ httpStatus, error, skipped }) {
  if (skipped) {
    return {
      status: OK,
      message: 'Skipped (no BOT_TOKEN)',
      fingerprint: 'skipped',
      details: [{ code: 'skipped' }],
    };
  }
  if (error) {
    return {
      status: ALERT,
      message: `Discord API unreachable: ${error}`,
      fingerprint: 'unreachable',
      details: [{ code: 'unreachable', error: String(error) }],
    };
  }
  if (httpStatus >= 200 && httpStatus < 300) {
    return {
      status: OK,
      message: 'Discord REST API reachable',
      fingerprint: 'ok',
      details: [],
    };
  }
  if (httpStatus === 429) {
    return {
      status: WARN,
      message: 'Discord API rate limited (429)',
      fingerprint: 'http:429',
      details: [{ code: 'http', status: 429 }],
    };
  }
  if (httpStatus === 401 || httpStatus === 403) {
    return {
      status: ALERT,
      message: `Discord rejected bot token (HTTP ${httpStatus})`,
      fingerprint: 'http:auth',
      details: [{ code: 'http', status: httpStatus }],
    };
  }
  if (httpStatus >= 500) {
    return {
      status: ALERT,
      message: `Discord API server error (HTTP ${httpStatus})`,
      fingerprint: `http:${httpStatus}`,
      details: [{ code: 'http', status: httpStatus }],
    };
  }
  return {
    status: ALERT,
    message: `Discord API unexpected response (HTTP ${httpStatus})`,
    fingerprint: `http:${httpStatus}`,
    details: [{ code: 'http', status: httpStatus }],
  };
}

function componentRank(status) {
  return COMPONENT_STATUS_RANK[status] || RANK[OK];
}

function incidentAffectsPaging(incident) {
  const comps = Array.isArray(incident?.components) ? incident.components : [];
  if (comps.some((c) => PAGING_COMPONENTS.has(c?.name))) return true;
  return /\b(api|gateway)\b/i.test(incident?.name || '');
}

function interpretDiscordStatus(summary, fetchError) {
  if (fetchError) {
    return {
      status: NO_DATA,
      message: `Could not reach Discord status page: ${fetchError}`,
      fingerprint: 'no_data',
      details: [{ code: 'no_data' }],
    };
  }
  if (!summary) {
    return {
      status: NO_DATA,
      message: 'Discord status page returned no data',
      fingerprint: 'no_data',
      details: [{ code: 'no_data' }],
    };
  }

  const details = [];
  const fingerprintParts = [];
  let rank = RANK[OK];

  const components = Array.isArray(summary.components) ? summary.components : [];
  for (const component of components) {
    if (!component || component.group) continue;
    if (!PAGING_COMPONENTS.has(component.name)) continue;
    const cRank = componentRank(component.status);
    if (cRank > RANK[OK]) {
      rank = Math.max(rank, cRank);
      details.push({
        kind: 'component',
        name: component.name,
        status: component.status,
        severity: statusFromRank(cRank),
      });
      fingerprintParts.push(`component:${component.name}:${component.status}`);
    }
  }

  const indicator = summary?.status?.indicator || 'none';
  const indicatorRank = INDICATOR_RANK[indicator] ?? RANK[OK];
  if (indicatorRank >= RANK[ALERT] && rank < RANK[ALERT]) {
    rank = Math.max(rank, indicatorRank);
    details.push({
      kind: 'platform',
      name: 'platform',
      status: indicator,
      description: summary?.status?.description || '',
      severity: statusFromRank(indicatorRank),
    });
    fingerprintParts.push(`platform:${indicator}`);
  }

  const incidents = Array.isArray(summary.incidents) ? summary.incidents : [];
  for (const incident of incidents) {
    const status = incident?.status || 'active';
    if (status === 'resolved' || status === 'postmortem') continue;
    const impactRank = IMPACT_RANK[incident?.impact] ?? RANK[WARN];
    const paging = incidentAffectsPaging(incident);
    if (!paging && impactRank < RANK[ALERT]) continue;
    const incidentRank = paging ? Math.max(impactRank, RANK[WARN]) : impactRank;
    rank = Math.max(rank, incidentRank);
    details.push({
      kind: 'incident',
      id: incident.id || incident.name,
      name: incident.name || 'Unnamed incident',
      status,
      impact: incident.impact || 'unknown',
      severity: statusFromRank(incidentRank),
    });
    fingerprintParts.push(`incident:${incident.id || incident.name}`);
  }

  const maintenances = Array.isArray(summary.scheduled_maintenances)
    ? summary.scheduled_maintenances
    : [];
  for (const maintenance of maintenances) {
    const status = maintenance?.status || '';
    if (status !== 'in_progress' && status !== 'verifying') continue;
    if (!incidentAffectsPaging(maintenance)) continue;
    rank = Math.max(rank, RANK[WARN]);
    details.push({
      kind: 'maintenance',
      id: maintenance.id || maintenance.name,
      name: maintenance.name || 'Scheduled maintenance',
      status,
      severity: WARN,
    });
    fingerprintParts.push(`maintenance:${maintenance.id || maintenance.name}`);
  }

  const status = statusFromRank(rank);
  const message =
    details.length === 0
      ? 'Discord API and Gateway operational'
      : details
          .map((d) => {
            if (d.kind === 'component') return `${d.name}: ${String(d.status).replaceAll('_', ' ')}`;
            if (d.kind === 'incident') return `Incident: ${d.name} (${d.status})`;
            if (d.kind === 'maintenance') return `Maintenance: ${d.name}`;
            return `Platform: ${d.description || d.status}`;
          })
          .join('; ');

  return {
    status,
    message,
    fingerprint: fingerprintParts.sort().join('|') || 'ok',
    details,
  };
}

function formatDuration(ms) {
  if (ms < 0) ms = 0;
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours < 24) return rem ? `${hours}h ${rem}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const rh = hours % 24;
  return rh ? `${days}d ${rh}h` : `${days}d`;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function normalizeStore(parsed) {
  const store = emptyStore();
  if (!parsed || !parsed.monitors) return store;
  for (const id of MONITOR_ORDER) {
    if (parsed.monitors[id]) store.monitors[id] = { ...store.monitors[id], ...parsed.monitors[id] };
  }
  if (parsed.composites) {
    for (const id of COMPOSITE_ORDER) {
      if (parsed.composites[id]) {
        store.composites[id] = { ...store.composites[id], ...parsed.composites[id] };
      }
    }
  }
  store.case = parsed.case || null;
  store.events = Array.isArray(parsed.events) ? parsed.events : [];
  return store;
}

async function loadStore(env) {
  if (!env.ALERT_STATE) return emptyStore();
  const raw = await env.ALERT_STATE.get(STATE_KEY);
  if (!raw) {
    const legacy = await env.ALERT_STATE.get('monitor_state_v1');
    if (!legacy) return emptyStore();
    try {
      return normalizeStore(JSON.parse(legacy));
    } catch {
      return emptyStore();
    }
  }
  try {
    return normalizeStore(JSON.parse(raw));
  } catch {
    return emptyStore();
  }
}

async function saveStore(env, store) {
  if (!env.ALERT_STATE) return;
  await env.ALERT_STATE.put(STATE_KEY, JSON.stringify({ ...store, version: 2 }));
}

function errMessage(err) {
  return err instanceof Error ? err.message : String(err);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryHttp(httpStatus, error) {
  if (error) return true;
  if (!httpStatus) return true;
  if (httpStatus >= 500) return true;
  if (httpStatus === 429 || httpStatus === 408) return true;
  return false;
}

async function withRetries(runAttempt, { retries = SYNTHETICS_RETRIES, intervalMs = SYNTHETICS_RETRY_MS, retryWhen } = {}) {
  let last = { error: 'no attempt' };
  for (let i = 0; i <= retries; i++) {
    const started = Date.now();
    try {
      last = await runAttempt();
      last.responseTime = Date.now() - started;
      last.attempt = i + 1;
      last.attempts = i + 1;
    } catch (err) {
      last = {
        error: errMessage(err),
        responseTime: Date.now() - started,
        attempt: i + 1,
        attempts: i + 1,
      };
    }
    const done = retryWhen ? !retryWhen(last) : !shouldRetryHttp(last.httpStatus, last.error);
    if (done) return last;
    if (i < retries) await sleep(intervalMs);
  }
  return last;
}

function attachProbeMeta(sample, raw) {
  return {
    ...sample,
    responseTime: raw.responseTime ?? null,
    httpStatus: raw.httpStatus ?? null,
    attempt: raw.attempt || 1,
    attempts: raw.attempts || raw.attempt || 1,
    checkStatus: CHECK_STATUS[sample.status],
  };
}

async function checkBotHealth() {
  const raw = await withRetries(
    async () => {
      const res = await fetch(BOT_CHECK_URL, {
        method: 'GET',
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      });
      const body = await res.json().catch(() => null);
      return { httpStatus: res.status, body };
    },
    {
      retryWhen: (raw) => {
        if (shouldRetryHttp(raw.httpStatus, raw.error)) return true;
        if (raw.httpStatus === 200 && raw.body?.success !== true) return true;
        return false;
      },
    }
  );
  return attachProbeMeta(interpretBotHealth(raw), raw);
}

async function checkDiscordStatusPage() {
  const raw = await withRetries(async () => {
    const res = await fetch(DISCORD_STATUS_URL, {
      method: 'GET',
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return { httpStatus: res.status, error: `HTTP ${res.status}` };
    return { httpStatus: res.status, summary: await res.json() };
  });
  const sample = raw.summary
    ? interpretDiscordStatus(raw.summary)
    : interpretDiscordStatus(null, raw.error || `HTTP ${raw.httpStatus}`);
  return attachProbeMeta(sample, raw);
}

async function checkDiscordRestApi(env) {
  if (!env.BOT_TOKEN) return attachProbeMeta(interpretDiscordApi({ skipped: true }), { attempt: 1 });
  const raw = await withRetries(async () => {
    const res = await fetch(DISCORD_API_URL, {
      method: 'GET',
      headers: { Authorization: `Bot ${env.BOT_TOKEN}` },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    return { httpStatus: res.status };
  });
  return attachProbeMeta(interpretDiscordApi(raw), raw);
}

function downtimeActive(env) {
  const flag = String(env.MONITOR_DOWNTIME || '').toLowerCase();
  if (flag === '1' || flag === 'true' || flag === 'yes') {
    return { active: true, scope: '*', message: 'MONITOR_DOWNTIME' };
  }
  return { active: false };
}

function waitWebhookUrl(webhookUrl) {
  const waitUrl = new URL(webhookUrl);
  waitUrl.searchParams.set('wait', 'true');
  return waitUrl;
}

function messageUrl(webhookUrl, messageId) {
  const url = new URL(webhookUrl);
  url.pathname = `${url.pathname.replace(/\/$/, '')}/messages/${messageId}`;
  return url;
}

function severityLabel(status) {
  return OVERALL_STATE[status] || 'Unknown';
}

function pendingLine(state, def) {
  if (state.status !== OK || state.lastSampleStatus === OK) return '';
  const threshold =
    state.lastSampleStatus === ALERT
      ? def.alertAfter
      : state.lastSampleStatus === WARN
        ? def.warnAfter
        : def.noDataAfter;
  return `\nEvaluating: ${state.consecutive[state.lastSampleStatus] || 0}/${threshold} consecutive (require_full_window)`;
}

function monitorField(state) {
  const def = MONITOR_DEFS[state.id];
  const muted = state.muted ? ` · muted (${state.muteReason})` : '';
  const latency = state.responseTime != null ? `\nLatency: ${state.responseTime}ms · retries ${Math.max(0, (state.attempts || 1) - 1)}` : '';
  const lines = [
    `\`${severityLabel(state.status)}\`  check_status=${state.checkStatus}${muted}`,
    state.message || def.query,
    pendingLine(state, def) + latency,
  ].filter(Boolean);
  return { name: `${def.name}  {${def.tags[0]}}`, value: lines.join('\n').slice(0, 1024), inline: false };
}

function compositeField(state) {
  return {
    name: `${state.name}  [composite]`,
    value: `\`${severityLabel(state.status)}\`\n\`${state.query}\``,
    inline: false,
  };
}

function buildCaseEmbed({ plan, monitors, composites, now, statusPage, recovered, renotifyMs, downtime }) {
  const severity = recovered ? OK : plan.case.severity;
  const eventName =
    recovered ? 'Recovered' : plan.eventType === 'renotify' ? 'Renotify' : plan.eventType === 'warn' ? 'Warn' : 'Triggered';
  const duration = formatDuration(now - (plan.case.openedAt || now));
  const tags = DEFAULT_TAGS.map((t) => `\`${t}\``).join(' ');

  const description = recovered
    ? `Case \`${plan.case.id}\` recovered after ${duration}.\nAll monitors OK. overall_state=${OVERALL_STATE[OK]}`
    : [
        `Case \`${plan.case.id}\` · ${eventName} · open ${duration}`,
        downtime?.active ? `**Silenced** (downtime: ${downtime.message})` : null,
        `Notify on transition · synthetics retries=${SYNTHETICS_RETRIES} · consecutive window · renotify ${formatDuration(renotifyMs)}`,
        `Tags: ${tags}`,
      ]
        .filter(Boolean)
        .join('\n');

  return {
    author: {
      name: `Cypher Monitoring · ${eventName} · ${severityLabel(severity)}`,
      icon_url: 'https://i.imgur.com/ZDYu6Kp.png',
      url: statusPage,
    },
    title: recovered ? '[Recovered] All monitors OK' : `[${eventName}] ${plan.case.title}`,
    description,
    color: EMBED_COLORS[severity] || EMBED_COLORS[NO_DATA],
    fields: [
      ...COMPOSITE_ORDER.map((id) => compositeField(composites[id])),
      ...MONITOR_ORDER.map((id) => monitorField(monitors[id])),
    ],
    footer: {
      text: recovered
        ? `${plan.case.id} · recovered`
        : `${plan.case.id} · next renotify ${formatDuration(
            Math.max(
              0,
              renotifyMs - (now - (plan.case.lastRenotifyAt || plan.case.lastNotifiedAt || plan.case.openedAt || now))
            )
          )}`,
    },
    timestamp: new Date(now).toISOString(),
  };
}

function pingContent(role, ping) {
  if (!ping || !role) return null;
  return `<@&${role}>`;
}

async function postWebhook(webhookUrl, payload) {
  const res = await fetch(waitWebhookUrl(webhookUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) return { ok: false, status: res.status, text, messageId: null };
  let messageId = null;
  try {
    messageId = JSON.parse(text)?.id || null;
  } catch {
    messageId = null;
  }
  return { ok: true, status: res.status, text, messageId };
}

async function patchWebhook(webhookUrl, messageId, payload) {
  const res = await fetch(messageUrl(webhookUrl, messageId), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, status: res.status, text };
  }
  return { ok: true, status: res.status };
}

async function upsertCaseMessage(webhookUrl, messageId, payload) {
  if (messageId) {
    const patched = await patchWebhook(webhookUrl, messageId, payload);
    if (patched.ok) return { ok: true, messageId, method: 'patch' };
  }
  const posted = await postWebhook(webhookUrl, payload);
  return { ...posted, method: 'post' };
}

function datadogEvent({ now, plan, title, text, alertType }) {
  return {
    date_happened: Math.floor(now / 1000),
    alert_type: alertType,
    event_type: 'monitor',
    source_type_name: 'cypher_monitoring',
    title,
    text,
    tags: DEFAULT_TAGS,
    priority: plan.ping ? 'normal' : 'low',
    aggregation_key: plan.case?.id || 'none',
  };
}

async function deliverNotifications({ env, plan, monitors, composites, now, renotifyMs, downtime }) {
  const webhookUrl = env.WEBHOOK_URL;
  const role = env.ROLE ? String(env.ROLE) : '';
  const statusPage = env.STATUS_PAGE_URL || 'https://cyphvr.xyz/status/';

  if (plan.action === 'none') {
    return { sent: false, ping: false, action: 'none', case: plan.case, events: [] };
  }
  if (downtime.active) {
    return {
      sent: false,
      ping: false,
      action: plan.action,
      skipped: `downtime:${downtime.message}`,
      case: { ...plan.case, lastNotifiedAt: plan.case?.lastNotifiedAt || 0 },
      events: [
        datadogEvent({
          now,
          plan,
          title: `[Silenced] ${plan.case.title}`,
          text: `Notification suppressed by downtime (${downtime.message}).`,
          alertType: 'info',
        }),
      ],
    };
  }
  if (!webhookUrl) {
    return {
      sent: false,
      ping: false,
      action: plan.action,
      skipped: 'WEBHOOK_URL missing',
      case: plan.case,
      events: [],
    };
  }

  const recovered = plan.action === 'resolve';
  const embed = buildCaseEmbed({
    plan,
    monitors,
    composites,
    now,
    statusPage,
    recovered,
    renotifyMs,
    downtime,
  });
  const nextCase = { ...plan.case, events: [...(plan.case.events || [])] };
  const ping = Boolean(plan.ping);

  const casePayload = {
    content: plan.action === 'open' ? pingContent(role, ping) : null,
    embeds: [embed],
    allowed_mentions: plan.action === 'open' && ping ? { roles: role ? [role] : [] } : { parse: [] },
  };

  const upserted = await upsertCaseMessage(webhookUrl, nextCase.discordMessageId, casePayload);
  if (!upserted.ok) {
    console.error('Webhook failed:', upserted.status, upserted.text);
    return { sent: false, ping: false, action: plan.action, error: upserted.status, case: plan.case, events: [] };
  }
  if (upserted.messageId) nextCase.discordMessageId = upserted.messageId;
  if (plan.action === 'open') nextCase.lastNotifiedAt = now;

  if ((plan.action === 'escalate' || plan.action === 'renotify') && ping) {
    const follow = await postWebhook(webhookUrl, {
      content: pingContent(role, true),
      embeds: [
        {
          author: {
            name:
              plan.action === 'renotify'
                ? 'Cypher Monitoring · still ALERT'
                : 'Cypher Monitoring · escalated',
            icon_url: 'https://i.imgur.com/ZDYu6Kp.png',
            url: statusPage,
          },
          description:
            plan.action === 'renotify'
              ? `Case \`${nextCase.id}\` still ALERT after ${formatDuration(now - (nextCase.openedAt || now))}.`
              : `Case \`${nextCase.id}\` escalated to ALERT.`,
          color: EMBED_COLORS[ALERT],
        },
      ],
      allowed_mentions: { roles: role ? [role] : [] },
    });
    if (follow.ok && follow.messageId) {
      nextCase.followupMessageIds = [...(nextCase.followupMessageIds || []), follow.messageId];
    }
    nextCase.lastRenotifyAt = now;
    nextCase.lastNotifiedAt = nextCase.lastNotifiedAt || now;
  }

  if (recovered) {
    nextCase.status = 'resolved';
    nextCase.resolvedAt = now;
  }

  const alertType = recovered ? 'success' : plan.eventType === 'warn' ? 'warning' : ping ? 'error' : 'info';
  const event = datadogEvent({
    now,
    plan,
    title: recovered ? `[Recovered] ${nextCase.title}` : `[${severityLabel(nextCase.severity)}] ${nextCase.title}`,
    text: recovered ? 'All monitors OK' : nextCase.title,
    alertType,
  });
  nextCase.events = [...nextCase.events, event].slice(-EVENT_LIMIT);

  return { sent: true, ping, action: plan.action, case: nextCase, events: [event] };
}

function publicMonitor(state) {
  const def = MONITOR_DEFS[state.id];
  return {
    id: state.id,
    name: def.name,
    type: def.type,
    query: def.query,
    tags: def.tags,
    priority: def.priority,
    overall_state: OVERALL_STATE[state.status],
    overall_state_modified: state.lastTransitionAt || null,
    last_triggered_ts: state.lastTriggeredAt || null,
    check_status: state.checkStatus,
    last_sample: state.lastSampleStatus,
    consecutive: state.consecutive,
    options: def.options,
    muted: state.muted,
    muteReason: state.muteReason,
    message: state.message,
    fingerprint: state.fingerprint,
    response_time_ms: state.responseTime,
    http_status: state.httpStatus,
    attempts: state.attempts,
    evaluation_window: state.window || [],
    history: state.history || [],
  };
}

function publicComposite(state) {
  const def = COMPOSITE_DEFS[state.id];
  return {
    id: state.id,
    name: def.name,
    type: 'composite',
    query: def.query,
    tags: def.tags,
    priority: def.priority,
    overall_state: OVERALL_STATE[state.status],
    overall_state_modified: state.lastTransitionAt || null,
    last_triggered_ts: state.lastTriggeredAt || null,
    check_status: state.checkStatus,
  };
}

export default async function handler(request, env) {
  try {
    const now = Date.now();
    const downtime = downtimeActive(env);
    const [bot, discordPage, discordApi] = await Promise.all([
      checkBotHealth(),
      checkDiscordStatusPage(),
      checkDiscordRestApi(env),
    ]);

    const samples = {
      'bot.health': bot,
      'discord.status': discordPage,
      'discord.api': discordApi,
    };

    const store = await loadStore(env);
    const renotifyMs = Number(env.MONITOR_RENOTIFY_MS) || RENOTIFY_MS;
    const evaluated = evaluateTick({ store, samples, now, renotifyMs });

    await saveStore(env, {
      version: 2,
      monitors: evaluated.monitors,
      composites: evaluated.composites,
      case: store.case,
      events: store.events,
    });

    const delivery = await deliverNotifications({
      env,
      plan: evaluated.plan,
      monitors: evaluated.monitors,
      composites: evaluated.composites,
      now,
      renotifyMs,
      downtime,
    });

    const nextCase = delivery.case || evaluated.plan.case;
    const events = [...(store.events || []), ...(delivery.events || [])].slice(-EVENT_LIMIT);
    await saveStore(env, {
      version: 2,
      monitors: evaluated.monitors,
      composites: evaluated.composites,
      case: nextCase,
      events,
    });

    const uniqueIssues = MONITOR_ORDER.flatMap((id) => {
      const state = evaluated.monitors[id];
      if (!state || state.status === OK) return [];
      return [`${MONITOR_DEFS[id].name}: ${state.message}`];
    });

    return json({
      success: true,
      healthy: evaluated.overall === OK,
      overall: evaluated.overall,
      overall_state: OVERALL_STATE[evaluated.overall],
      paging: evaluated.paging,
      paging_state: OVERALL_STATE[evaluated.paging],
      botDown: evaluated.monitors['bot.health'].status === ALERT,
      discordStatusOk: evaluated.monitors['discord.status'].status === OK,
      discordApiOk: evaluated.monitors['discord.api'].status === OK,
      composites: {
        'page.bot': evaluated.composites['composite.page.bot'].status === ALERT,
        'page.discord': evaluated.composites['composite.page.discord'].status === ALERT,
      },
      composite_monitors: COMPOSITE_ORDER.map((id) => publicComposite(evaluated.composites[id])),
      monitors: MONITOR_ORDER.map((id) => publicMonitor(evaluated.monitors[id])),
      case: nextCase,
      events,
      downtime,
      evaluation: {
        at: now,
        frequency: '1m',
        window: `${WINDOW_LIMIT}m`,
        synthetics_retries: SYNTHETICS_RETRIES,
        statePersisted: Boolean(env.ALERT_STATE),
        renotifyMs,
        require_full_window: true,
      },
      notify: {
        action: delivery.action,
        sent: delivery.sent,
        ping: delivery.ping,
        skipped: delivery.skipped || null,
      },
      issues: uniqueIssues,
      alertSent: Boolean(delivery.sent && delivery.ping),
    });
  } catch (error) {
    console.error('Monitor error:', error);
    return json({ error: 'Monitor check failed' }, 500);
  }
}
