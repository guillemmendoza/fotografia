// Directori curat de les pel·lícules més habituals: ISO nativa, tipus (color/B·N)
// i format(s) més comuns amb el nombre d'exposicions típic de cada format.
// No cal que sigui exhaustiu: l'usuari sempre pot escriure'n una altra a mà.
const FILM_STOCKS = [
  { nom: 'Kodak Portra 160', iso: 160, tipus: 'color', formats: ['35mm', '120'] },
  { nom: 'Kodak Portra 400', iso: 400, tipus: 'color', formats: ['35mm', '120'] },
  { nom: 'Kodak Portra 800', iso: 800, tipus: 'color', formats: ['35mm', '120'] },
  { nom: 'Kodak Gold 200', iso: 200, tipus: 'color', formats: ['35mm'] },
  { nom: 'Kodak ColorPlus 200', iso: 200, tipus: 'color', formats: ['35mm'] },
  { nom: 'Kodak Ultramax 400', iso: 400, tipus: 'color', formats: ['35mm'] },
  { nom: 'Kodak Ektar 100', iso: 100, tipus: 'color', formats: ['35mm', '120'] },
  { nom: 'Kodak Tri-X 400', iso: 400, tipus: 'bn', formats: ['35mm', '120'] },
  { nom: 'Kodak T-Max 100', iso: 100, tipus: 'bn', formats: ['35mm', '120'] },
  { nom: 'Kodak T-Max 400', iso: 400, tipus: 'bn', formats: ['35mm', '120'] },
  { nom: 'Kodak ProImage 100', iso: 100, tipus: 'color', formats: ['35mm'] },
  { nom: 'Kodak Vision3 250D', iso: 250, tipus: 'color', formats: ['35mm'] },
  { nom: 'Kodak Vision3 500T', iso: 500, tipus: 'color', formats: ['35mm'] },
  { nom: 'Fujifilm Superia X-TRA 400', iso: 400, tipus: 'color', formats: ['35mm'] },
  { nom: 'Fujifilm 200', iso: 200, tipus: 'color', formats: ['35mm'] },
  { nom: 'Fujifilm Pro 400H', iso: 400, tipus: 'color', formats: ['35mm', '120'] },
  { nom: 'Fujifilm Provia 100F', iso: 100, tipus: 'color', formats: ['35mm', '120'] },
  { nom: 'Fujifilm Velvia 50', iso: 50, tipus: 'color', formats: ['35mm', '120'] },
  { nom: 'Fujifilm Velvia 100', iso: 100, tipus: 'color', formats: ['35mm', '120'] },
  { nom: 'Fujifilm Acros 100 II', iso: 100, tipus: 'bn', formats: ['35mm', '120'] },
  { nom: 'Ilford HP5 Plus 400', iso: 400, tipus: 'bn', formats: ['35mm', '120'] },
  { nom: 'Ilford FP4 Plus 125', iso: 125, tipus: 'bn', formats: ['35mm', '120'] },
  { nom: 'Ilford Delta 100', iso: 100, tipus: 'bn', formats: ['35mm', '120'] },
  { nom: 'Ilford Delta 400', iso: 400, tipus: 'bn', formats: ['35mm', '120'] },
  { nom: 'Ilford Delta 3200', iso: 3200, tipus: 'bn', formats: ['35mm', '120'] },
  { nom: 'Ilford Pan F Plus 50', iso: 50, tipus: 'bn', formats: ['35mm', '120'] },
  { nom: 'Ilford XP2 Super 400', iso: 400, tipus: 'bn', formats: ['35mm', '120'] },
  { nom: 'Ilford Ortho Plus 80', iso: 80, tipus: 'bn', formats: ['35mm', '120'] },
  { nom: 'CineStill 400D', iso: 400, tipus: 'color', formats: ['35mm'] },
  { nom: 'CineStill 800T', iso: 800, tipus: 'color', formats: ['35mm'] },
  { nom: 'CineStill BwXX', iso: 250, tipus: 'bn', formats: ['35mm'] },
  { nom: 'Lomography Color 100', iso: 100, tipus: 'color', formats: ['35mm', '120'] },
  { nom: 'Lomography Color 400', iso: 400, tipus: 'color', formats: ['35mm', '120'] },
  { nom: 'Lomography Color 800', iso: 800, tipus: 'color', formats: ['35mm'] },
  { nom: 'Lomography Lady Grey 400', iso: 400, tipus: 'bn', formats: ['35mm', '120'] },
  { nom: 'Lomography Earl Grey 100', iso: 100, tipus: 'bn', formats: ['35mm', '120'] },
  { nom: 'Agfaphoto APX 100', iso: 100, tipus: 'bn', formats: ['35mm', '120'] },
  { nom: 'Agfaphoto APX 400', iso: 400, tipus: 'bn', formats: ['35mm'] },
  { nom: 'Rollei RPX 25', iso: 25, tipus: 'bn', formats: ['35mm', '120'] },
  { nom: 'Rollei RPX 100', iso: 100, tipus: 'bn', formats: ['35mm', '120'] },
  { nom: 'Rollei RPX 400', iso: 400, tipus: 'bn', formats: ['35mm', '120'] },
  { nom: 'Kentmere Pan 100', iso: 100, tipus: 'bn', formats: ['35mm'] },
  { nom: 'Kentmere Pan 400', iso: 400, tipus: 'bn', formats: ['35mm'] },
  { nom: 'Polaroid Color 600', iso: 640, tipus: 'color', formats: ['altres'], exposicions: 8 },
  { nom: 'Polaroid B&W 600', iso: 640, tipus: 'bn', formats: ['altres'], exposicions: 8 },
  { nom: 'Polaroid Color i-Type', iso: 640, tipus: 'color', formats: ['altres'], exposicions: 8 },
  { nom: 'Fujifilm Instax Mini', iso: 800, tipus: 'color', formats: ['altres'], exposicions: 10 },
  { nom: 'Fomapan 100', iso: 100, tipus: 'bn', formats: ['35mm', '120'] },
  { nom: 'Fomapan 400', iso: 400, tipus: 'bn', formats: ['35mm', '120'] },
  { nom: 'JCH StreetPan 400', iso: 400, tipus: 'bn', formats: ['35mm'] },
  { nom: 'Adox CHS 100 II', iso: 100, tipus: 'bn', formats: ['35mm', '120'] },
  { nom: 'Adox Silvermax', iso: 100, tipus: 'bn', formats: ['35mm', '120'] }
];

// Exposicions habituals per format quan la pel·lícula no en marca una de pròpia
// (les 120 varien segons la càmera — 6x6=12, 6x4.5=15/16, 6x7=10 — 12 és la més freqüent).
const EXPOSICIONS_PER_FORMAT = { '35mm': 36, '120': 12, altres: null };

function trobarFilmStock(nom) {
  if (!nom) return null;
  const net = nom.trim().toLowerCase();
  return FILM_STOCKS.find(f => f.nom.toLowerCase() === net) || null;
}

function suggerirExposicions(stock, format) {
  if (stock?.exposicions) return stock.exposicions;
  return EXPOSICIONS_PER_FORMAT[format] ?? null;
}
