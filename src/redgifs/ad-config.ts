export const redgifsAdRuleIds = [300, 301];

/** Request paths and promotion hosts observed in Redgifs' own ad components. */
export function redgifsAdRules(tabIds: number[]): chrome.declarativeNetRequest.Rule[] {
  if (!tabIds.length) return [];
  return [{
    id: 300, priority: 1,
    action: { type: 'block' as chrome.declarativeNetRequest.RuleActionType },
    condition: { tabIds, initiatorDomains: ['redgifs.com'],
      regexFilter: '^https://api\\.redgifs\\.com/v2/(adv/|cameron/streamate/)',
      resourceTypes: ['xmlhttprequest' as chrome.declarativeNetRequest.ResourceType] },
  }, {
    id: 301, priority: 1,
    action: { type: 'block' as chrome.declarativeNetRequest.RuleActionType },
    condition: { tabIds, initiatorDomains: ['redgifs.com'], requestDomains: ['rgcams.com', 'a.aivanta76.com'] },
  }];
}
