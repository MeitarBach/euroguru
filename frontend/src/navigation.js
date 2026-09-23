import { LayoutDashboard, Users, TrendingUp, ScatterChart } from 'lucide-react';

/**
 * The app's four destinations, defined once.
 *
 * Two components render this now - the desktop sidebar and the mobile tab bar - and a
 * second copy would eventually disagree with the first about a label or an id.
 *
 * `short` is for the tab bar, where a label sits under a 20px icon in roughly a quarter
 * of the screen width: "Recommendations" does not fit there, "Picks" does.
 */
export const NAV_ITEMS = [
    { id: 'dashboard', label: 'Dashboard', short: 'Home', icon: LayoutDashboard },
    { id: 'stats', label: 'Player Stats', short: 'Players', icon: Users },
    { id: 'viz', label: 'Court Vision', short: 'Charts', icon: ScatterChart },
    { id: 'recs', label: 'Recommendations', short: 'Picks', icon: TrendingUp },
];
