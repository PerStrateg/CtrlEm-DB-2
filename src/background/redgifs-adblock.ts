import { WriteQueue } from '../storage/library-store';
import { redgifsAdRuleIds, redgifsAdRules } from '../redgifs/ad-config';

/** Session rules stay confined to CtrlEm tabs, including across worker wakeups. */
export function registerRedgifsAdblock(): void {
  const queue = new WriteQueue();
  const refresh = () => {
    void queue.run(async () => {
      const tabs = await chrome.tabs.query({ url: ['https://ctrlem.com/u/*', 'https://ctrlem.com/groups/*'] });
      const tabIds = tabs.flatMap(tab => tab.id === undefined ? [] : [tab.id]);
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: redgifsAdRuleIds, addRules: redgifsAdRules(tabIds) });
    }).catch(() => console.warn('[CtrlEm DB RG] Could not update ad blocking rules.'));
  };
  chrome.tabs.onUpdated.addListener((_id, change) => { if (change.url) refresh(); });
  chrome.tabs.onRemoved.addListener(refresh);
  refresh();
}
