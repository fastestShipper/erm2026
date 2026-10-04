// Veda electoral: qué mensajes de los agentes esperan hasta el cierre de la votación.
//
// Hasta las 17:00 de Lima del 4 de octubre el exportador retiene todo mensaje que mencione
// candidatos, organizaciones políticas, encuestas, proyecciones, tendencias o cifras de votos.
// No se borran: se publican solos al cierre, con su hora original.
// Los mensajes sobre apuestas o mercados de predicción no se publican nunca.
//
// Base: Ley Orgánica de Elecciones (arts. 190, 191 y 389), Reglamento sobre Encuestas
// Electorales del JNE (Res. 0107-2025-JNE) y sentencia del Tribunal Constitucional 02-2001-AI/TC.
//
// Las listas vienen del JNE: partidos y movimientos regionales habilitados para las ERM 2026 y los
// 26 candidatos a la alcaldía de Lima Metropolitana. Para los demás candidatos del país el filtro
// se apoya en las palabras genéricas (candidato, partido, movimiento regional…): es un freno
// automático, no reemplaza la regla que ya tienen los agentes en su brief.
import fs from 'node:fs';

export const VEDA_FIN = Date.parse(process.env.ERM_VEDA_FIN || '2026-10-04T17:00:00-05:00');

/** minúsculas, sin tildes y sin signos: «López-Aliaga (RP)» → «lopez aliaga rp» */
export const frase = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const PARTIDOS = [
  'Acción Popular', 'Adelante Pueblo Unido', 'Ahora Nación', 'Alianza para el Progreso', 'Avanza País', 'Batalla Perú',
  'Tierra Verde', 'Inka Perú', 'Fe en el Perú', 'Frente Popular Agrícola', 'Frepap', 'Fuerza Ciudadana', 'Fuerza Popular',
  'Juntos por el Perú', 'Libertad Popular', 'Nuevo Perú', 'Partido Aprista', 'Apra', 'Aprista', 'Apristas', 'Ciudadanos por el Perú',
  'Cívico Obras', 'Partido de los Trabajadores y Emprendedores', 'Partido del Buen Gobierno', 'Demócrata Unido', 'Demócrata Verde',
  'Democrático Federal', 'Somos Perú', 'Frente de la Esperanza', 'Partido Morado', 'País para Todos', 'Partido Patriótico',
  'Cooperación Popular', 'Fuerza Moderna', 'Integridad Democrática', 'Perú Libre', 'Perú Acción', 'Perú Primero', 'Peruanos Unidos',
  'Voces del Pueblo', 'Prin', 'Pueblo Consciente', 'Todo con el Pueblo', 'Partido Popular Cristiano', 'PPC',
  'Entendimiento, Recuperación y la Unificación', 'Sicreo', 'Partido Sí Creo', 'Unidad y Paz', 'Perú Moderno', 'Podemos Perú',
  'Primero la Gente', 'Progresemos', 'Renovación Popular', 'Resurgimiento Unido Nacional', 'Salvemos al Perú', 'Un Camino Diferente',
  'Unidad Popular', 'Visión Perú', 'Verdad y Honradez', 'Venceremos', 'Fujimorismo', 'Fujimorista', 'Fujimoristas',
];

const MOVIMIENTOS = [
  'Amazonense Unidos al Campo', 'Victoria Amazonense', 'Sentimiento Amazonense', 'Alianza Gobierno Unidad y Acción',
  'Acción Nacionalista Peruano', 'Movimiento Ama Sua', 'Áncash Renace', 'El Maicito', 'Socios por Áncash', 'Hatariy Apurímac',
  'Yaku Apurímac', 'Progresista de Apurímac', 'Arequipa, Tradición y Futuro', 'Fuerza Arequipeña', 'Arequipa Avancemos',
  'Arequipa es Primero', 'Yo Arequipa', 'Alianza por Nuestro Desarrollo', 'Trabaja Ayacucho', 'Wari Llaqta', 'Cajamarca Siempre Verde',
  'Cajamarca Renace', 'Contigo Callao', 'Más Callao', 'Frente Regional Túpac', 'Inka Pachakuteq', 'El Pueblo Primero',
  'Integración Regional Tarpuy', 'Integración Huancavelicana', 'Qatary Huancavelica', 'Unidad Regional Huancavelicana',
  'Huánuco Primero', 'Mi Buen Vecino', 'Cambiemos por Huánuco', 'Unidos por el Desarrollo de Huánuco', 'Obras por la Modernidad',
  'Uno por Ica', 'Caminemos Juntos por Junín', 'Junín Renace', 'Bloque Popular Junín', 'Sierra y Selva Contigo Junín',
  'Unidos por Junín', 'Fortaleza Perú', 'Nueva Libertad', 'Trabajo Más Trabajo', 'Concertación para el Desarrollo Regional',
  'Unidad Cívica Lima', 'Patria Joven', 'Esperanza Región Amazónica', 'Voluntad General Amazónica', 'Reivindiquemos Loreto',
  'Alianza Libertad Madrediosense', 'Amor por Madre de Dios', 'Fuerza por Madre de Dios', 'Kausachun', 'Vamos Moquegua',
  'Pasco Emprendedor', 'Pasco Joven', 'Pasco Dignidad', 'Pasco Verde', 'Contigo Región', 'Fuerza Regional', 'Unidad Regional',
  'Región para Todos', 'Acción Social por la Integración', 'Moral y Desarrollo', 'Integración y Revolución Andina',
  'Obras Siempre Obras', 'Oportunidad y Liderazgo con Autonomía', 'Reforma y Honradez', 'Somos Pueblo', 'Viva Puno',
  'Unión Regional', 'Banderas Tacneñistas', 'Frente Esperanza por Tacna', 'Fuerza Tacna', 'Nueva Esperanza', 'Siempre Tacna',
  'Unidos por Tacna', 'Inclusión Regional', 'Dignidad Tumbesina', 'Tumbes Unido', 'Renovación Tumbesina', 'Cambio Ucayalino',
  'Movimiento Verde de Ucayali', 'Todos Somos Ucayali', 'Ucayali Región con Futuro',
];

// Candidatos a la alcaldía de Lima Metropolitana (26) y figuras nacionales de las organizaciones.
const PERSONAS = [
  'Tejada Noriega', 'Carlos Tejada', 'Susel Paredes', 'Susel', 'Alvarado Mestanza', 'Juan Carlos Alvarado', 'Riera Garro', 'Elio Riera',
  'Francis Allison', 'Allison', 'Samir Quispe', 'Quispe Caballero', 'Yehude Simon', 'Yehude', 'Segundo Valdez', 'Valdez Zavala',
  'Rubén Bonilla', 'Bonilla Espinoza', 'Samuel Daza', 'Daza Taype', 'Oswaldo Vargas', 'Vargas Cuellar', 'Mónica Yaya', 'Yaya Luyo',
  'Belmont', 'Carlos Gallardo', 'Gallardo Neyra', 'Flor Hurtado', 'Flor de María Hurtado', 'Hurtado Valdez', 'Carlos Bruce', 'Bruce',
  'Elizabeth León', 'León Chinchay', 'Victoria La Cruz', 'La Cruz Garcés', 'Sandro Caller', 'Caller Gutiérrez', 'Yuri Castro',
  'Castro Romero', 'Huette', 'De Pomar', 'Urresti', 'Luis Llanos', 'Miguel Llanos', 'Llanos Carrillo', 'López Aliaga', 'Porky',
  'Santiago Abarca', 'Abarca León',
  'Keiko', 'Fujimori', 'Acuña', 'Cerrón', 'Forsyth', 'Vizcarra', 'Antauro', 'Humala', 'Butters', 'Lescano', 'Luna Gálvez',
  'Reggiardo', 'Roberto Sánchez', 'López Chau', 'Carlos Álvarez', 'Molinelli',
];

const lista = (xs) => [...new Set(xs.map(frase).filter(Boolean))];
const NOMBRES = lista([...PARTIDOS, ...MOVIMIENTOS, ...PERSONAS]);
const NOMBRES_RE = new RegExp(` (?:${NOMBRES.join('|')}) `);
// nombres pegados, como en etiquetas y cuentas: #LopezAliaga, @fuerzapopular
const PEGADOS = NOMBRES.map((s) => s.replace(/ /g, '')).filter((s) => s.length >= 9);

// palabras que delatan que se habla de una candidatura o de una organización política
const POLITICA_RE = / (?:ex)?candidat| postul| aspirantes? a | partidos? | movimientos? (?:regional|regionales|independiente|independientes|politico|politicos) | (?:agrupacion|agrupaciones|organizacion|organizaciones|alianza|alianzas) (?:politica|politicas|electoral|electorales) | militantes? | simpatizantes? | partidari| reelecci| reeleg| vot(?:a|e|en|ar|aria|o) por | virtual(?:es)? (?:alcalde|alcaldesa|gobernador|gobernadora|ganador|ganadora)| (?:alcalde|gobernador) electo | (?:alcaldesa|gobernadora) electa /;

// encuestas, proyecciones, tendencias y cualquier adelanto de quién gana
const ENCUESTAS_RE = / encuest| sondeo| boca de urna | flash electoral | conteos? rapidos? | simulacro| proyecci| proyecta| intencion de voto | preferencias? | tendencia| favorit| lidera| encabeza | puntea| ventaja| se impone| arrasa| empate | cabeza a cabeza | gan(?:a|o|e|ar|aria|arian|ando|ador|adora|adores|aron|an|ara|aran) | resultados? (?:extraoficial|preliminar|filtrad|parcial|no oficial)| conteo (?:paralelo|extraoficial)| pronostic| probabilidad/;
const ENCUESTADORAS_RE = / ipsos | datum | cpi | iep /;

// Una frase que solo dice que NO habrá encuestas ni ganadores («la imagen no trae encuestas ni
// ganador», «nunca ganadores antes que la ONPE») no adelanta nada: se deja pasar. Tiene que negar
// antes de nombrar el tema y no puede seguir con un «pero».
const NIEGA_RE = / (?:no|sin|ni|nunca|cero|ningun|ninguna|ninguno|tampoco|jamas|nada de|prohibid[oa]s?|veda) /;
const CONTRASTE_RE = / (?:pero|aunque|sin embargo|salvo|excepto|aun asi|sino) /;
const partirFrases = (raw) => raw.split(/(?<!\d)[.:](?!\d)|[;!?\n]+|\s[-–—]\s/);
function adelantaAlgo(raw) {
  for (const parte of partirFrases(raw)) {
    const f = ` ${frase(parte)} `;
    const m = ENCUESTAS_RE.exec(f);
    if (!m) continue;
    const antes = f.slice(0, m.index + 1);
    if (!NIEGA_RE.test(antes) || CONTRASTE_RE.test(f)) return true;
  }
  return false;
}

// nunca se publica: apuestas y mercados de predicción
const NUNCA_RE = / apuesta| apost(?:ar|ador|adores|aron|o) | mercados? de prediccion/;
// términos adicionales que tampoco se publican (uno por línea), en un archivo fuera del repositorio
let NUNCA_EXTRA = [];
try {
  NUNCA_EXTRA = fs.readFileSync(new URL('../local/nunca.txt', import.meta.url), 'utf8').split(/\r?\n/).map(frase).filter(Boolean);
} catch { /* opcional */ }

// cifras de votos antes del cierre: «35 % de los votos», «1 240 votos»
const PORCENTAJE_RE = /\d\s?(?:%|por ciento)|\bpuntos porcentuales\b/i;
const CONTEXTO_VOTO_RE = / votos? | respaldo | apoyo | aprobacion /;
const CONTEO_RE = /\d[\d.,\s]*\s+votos\b/i;

/**
 * Por qué un mensaje no se publica todavía: 'nunca' (apuestas), 'veda' (espera al cierre) o null.
 * @param {string} texto  mensaje tal como lo escribió el agente
 * @param {number} ahora  hora actual en ms (para probar)
 */
export function retener(texto, ahora = Date.now()) {
  const raw = String(texto || '');
  const t = ` ${frase(raw)} `;
  if (NUNCA_RE.test(t) || NUNCA_EXTRA.some((x) => t.includes(` ${x}`))) return 'nunca';
  if (ahora >= VEDA_FIN) return null;
  if (POLITICA_RE.test(t) || NOMBRES_RE.test(t) || ENCUESTADORAS_RE.test(t)) return 'veda';
  if (adelantaAlgo(raw)) return 'veda';
  if (/\bAPP\b/.test(raw)) return 'veda';                       // sigla de un partido (en minúsculas es «aplicación»)
  if (CONTEO_RE.test(raw) || (PORCENTAJE_RE.test(raw) && CONTEXTO_VOTO_RE.test(t))) return 'veda';
  for (const palabra of t.split(' ')) {
    if (palabra.length >= 9 && PEGADOS.some((p) => palabra.includes(p))) return 'veda';
  }
  return null;
}
