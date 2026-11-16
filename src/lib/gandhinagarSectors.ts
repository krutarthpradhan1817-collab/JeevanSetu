/**
 * Centres of the Gandhinagar sectors (from OpenStreetMap). Used when the address service is slow or
 * unreachable, so "Sector 7 Gandhinagar" still resolves. Approximate: the centre of each sector.
 * © OpenStreetMap contributors (ODbL 1.0).
 */
export const GANDHINAGAR_SECTORS: Record<number, { lat: number; lng: number }> = {
  1: { lat: 23.200207, lng: 72.645786 },
  2: { lat: 23.202123, lng: 72.636877 },
  3: { lat: 23.20443, lng: 72.628974 },
  4: { lat: 23.209603, lng: 72.62315 },
  5: { lat: 23.186334, lng: 72.579479 },
  6: { lat: 23.183908, lng: 72.578325 },
  7: { lat: 23.210975, lng: 72.643035 },
  8: { lat: 23.206641, lng: 72.650403 },
  9: { lat: 23.213848, lng: 72.663155 },
  10: { lat: 23.215621, lng: 72.65504 },
  11: { lat: 23.219625, lng: 72.647857 },
  12: { lat: 23.222375, lng: 72.64114 },
  13: { lat: 23.227509, lng: 72.633258 },
  14: { lat: 23.236922, lng: 72.632759 },
  15: { lat: 23.233896, lng: 72.639045 },
  16: { lat: 23.230443, lng: 72.646494 },
  17: { lat: 23.227601, lng: 72.653744 },
  18: { lat: 23.216787, lng: 72.664744 },
  19: { lat: 23.222253, lng: 72.669473 },
  20: { lat: 23.228273, lng: 72.672067 },
  21: { lat: 23.231654, lng: 72.664542 },
  22: { lat: 23.23576, lng: 72.657335 },
  23: { lat: 23.237686, lng: 72.650917 },
  24: { lat: 23.242147, lng: 72.643867 },
  25: { lat: 23.247983, lng: 72.637016 },
  26: { lat: 23.254338, lng: 72.640608 },
  27: { lat: 23.251436, lng: 72.649819 },
  28: { lat: 23.247036, lng: 72.656338 },
  29: { lat: 23.244133, lng: 72.662922 },
  30: { lat: 23.240283, lng: 72.671203 },
};
