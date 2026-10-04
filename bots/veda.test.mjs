// node --test bots/veda.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { retener, VEDA_FIN } from './veda.mjs';

const antes = VEDA_FIN - 3600e3;
const despues = VEDA_FIN + 1000;

const PASAN = [
  'La ONPE informa 98,7 % de mesas instaladas a las 9:00.',
  'El portal de la ONPE sigue en Próximamente. Sin resultados.',
  '[FALSO] Circula un audio que dice que se amplió el horario; la ONPE lo desmintió.',
  'Llegó el brief. La bitácora pasa a ser de cada hora.',
  'Participación ciudadana: la ONPE reporta colas en San Juan de Lurigancho.',
  'Norma coordina la guardia de las 10:00 con Luchito y Rosita.',
  'Descarga la app de la ONPE para ubicar tu mesa.',
  'Podemos confirmar que la mesa abrió a las 7:05.',
  'El JNE recordó que hoy rige la ley seca hasta el lunes a las 8:00.',
  'Pieza viral con un acta trucada; no hay actas todavía porque la votación sigue.',
  'La ONPE publicará resultados después de las 17:00.',
  'La ONPE contó 45 % de electores que ya votaron al mediodía.',
  // decir que NO habrá encuestas ni ganadores no adelanta nada
  'Hasta las 17:00 la imagen no lleva encuestas ni boca de urna.',
  'La imagen no trae votos, encuestas ni ganador.',
  'Nunca ganadores antes de que lo diga la ONPE.',
  'Veda electoral: cero encuestas, proyecciones o boca de urna antes de las 17:00.',
];

const ESPERAN = [
  'Según Ipsos, hay empate en Lima.',
  'No hay encuesta oficial, pero la boca de urna da arriba al alcalde actual',
  'No lo vas a creer: ya hay ganador en Arequipa',
  'Sin confirmación oficial, aunque la tendencia es clara',
  'Un canal difundió una encuesta a boca de urna',
  'No es oficial. La proyección da una ventaja amplia.',
  'López Aliaga votó en San Isidro a las 8:10.',
  '#LopezAliaga es lo más comentado en X',
  '@fuerzapopular denunció problemas en una mesa',
  'El candidato de la lista 3 llegó a votar',
  'Un partido denunció falta de personeros',
  'Personeros de APP reclaman en Trujillo',
  'Tendría 35 % de los votos según una foto viral',
  'Dicen que sacó 1 240 votos en la mesa 045123',
  'Carlos Bruce llegó a su local de votación',
  'El Movimiento Regional Agua presentó un reclamo',
  'Somos Pueblo pide ampliar el horario en Puno',
  'Vota por la lista del pueblo',
  'Fujimori emitió su voto',
  'Las tendencias en X a esta hora',
  'El virtual alcalde agradeció a sus vecinos',
  'Una organización política presentó una tacha',
  'Ya hay ganador en Arequipa, dicen en un canal',
];

const NUNCA = [
  'Las casas de apuestas no son una fuente',
  'Los mercados de predicción se movieron',
];

test('mensajes neutrales se publican durante la veda', () => {
  for (const s of PASAN) assert.equal(retener(s, antes), null, s);
});

test('candidatos, organizaciones, encuestas y cifras de votos esperan al cierre', () => {
  for (const s of ESPERAN) assert.equal(retener(s, antes), 'veda', s);
});

test('al cierre de la votación se publican', () => {
  for (const s of ESPERAN) assert.equal(retener(s, despues), null, s);
});

test('apuestas y mercados de predicción no se publican nunca', () => {
  for (const s of NUNCA) {
    assert.equal(retener(s, antes), 'nunca', s);
    assert.equal(retener(s, despues), 'nunca', s);
  }
});
