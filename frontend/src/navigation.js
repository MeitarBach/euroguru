import { LayoutDashboard, Users, TrendingUp, ScatterChart, Radio } from 'lucide-react';

/**
 * The app's destinations, defined once.
 *
 * Two components render this now - the desktop sidebar and the mobile tab bar - and a
 * second copy would eventually disagree with the first about a label or an id.
 *
 * `short` is for the tab bar, where a label sits under a 20px icon in roughly a quarter
 * of the screen width: "Recommendations" does not fit there, "Picks" does.
 *
 * `gated` tabs show a preview when signed out; the nav marks them with a lock so the
 * limit is not a surprise. `badge` is a small tag shown beside the label in both
 * navigations - drop it from the entry to retire it.
 */
export const NAV_ITEMS = [
    { id: 'dashboard', label: 'Dashboard', short: 'Home', icon: LayoutDashboard },
    { id: 'live', label: 'Live', short: 'Live', icon: Radio, badge: 'Beta' },
    { id: 'stats', label: 'Player Stats', short: 'Players', icon: Users, gated: true },
    { id: 'viz', label: 'Court Vision', short: 'Charts', icon: ScatterChart, gated: true },
    { id: 'recs', label: 'Recommendations', short: 'Picks', icon: TrendingUp, gated: true },
];
