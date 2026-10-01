/**
 * Dunkest's team codes -> the Euroleague codes the live boxscore and schedule use.
 *
 * A copy of DUNKEST_TEAM_CODES in backend/utils/data_processing.py, which is where the
 * mapping is maintained; keep the two in step. Most clubs share a code, but a third do
 * not ("PAO" is "PAN" to Euroleague), and a player's team has to be translated before
 * their line can be found in a game.
 */
export const DUNKEST_TO_EL = {
    ASV: 'ASV', // LDLC Asvel Villeurbanne
    BAR: 'BAR', // FC Barcelona
    BAY: 'MUN', // FC Bayern Munich
    BJK: 'BES', // Besiktas Istanbul
    CZV: 'RED', // Crvena Zvezda Belgrade
    DUB: 'DUB', // Dubai Basketball
    EFS: 'IST', // Anadolu Efes Istanbul
    FBT: 'ULK', // Fenerbahce Istanbul
    HTA: 'HTA', // Hapoel Tel Aviv
    KBA: 'BAS', // Baskonia Vitoria-Gasteiz
    MIL: 'MIL', // Olimpia Milan
    MTA: 'TEL', // Maccabi Tel Aviv
    OLY: 'OLY', // Olympiacos Piraeus
    PAO: 'PAN', // Panathinaikos Athens
    PAR: 'PAR', // Partizan Belgrade
    PBB: 'PRS', // Paris Basketball
    RMB: 'MAD', // Real Madrid
    VBC: 'PAM', // Valencia Basket
    VIR: 'VIR', // Virtus Bologna
    ZAL: 'ZAL', // Zalgiris Kaunas
};

/** The Euroleague code for a roster row: the merged TeamCode, else the translated Team. */
export const euroleagueCode = (player) =>
    player?.TeamCode || DUNKEST_TO_EL[String(player?.Team ?? '').toUpperCase()] || null;
