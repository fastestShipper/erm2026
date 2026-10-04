"""Pruebas del colector:  python3 -m unittest discover -s collector"""
import unittest

import collect


def fila(nombre, votos, cod=None, candidato='X'):
    return {'nombreAgrupacionPolitica': nombre, 'codigoAgrupacionPolitica': cod, 'nombreCandidato': candidato,
            'dniCandidato': '00000000', 'totalVotosValidos': votos, 'porcentajeVotosValidos': None,
            'porcentajeVotosEmitidos': None}


class Participantes(unittest.TestCase):
    def test_blancos_y_nulos_nunca_van_primero(self):
        p = collect.compact_participants([fila('VOTOS EN BLANCO', 900), fila('PARTIDO A', 500, 1),
                                          fila('VOTOS NULOS', 700), fila('PARTIDO B', 600, 2)])
        self.assertEqual([x['partido'] for x in p], ['PARTIDO B', 'PARTIDO A', 'VOTOS EN BLANCO', 'VOTOS NULOS'])
        self.assertTrue(all(x.get('especial') for x in p[2:]))
        self.assertFalse(any(x.get('especial') for x in p[:2]))

    def test_no_copia_el_dni(self):
        p = collect.compact_participants([fila('PARTIDO A', 5, 1)])
        self.assertNotIn('dni', p[0])

    def test_limite_conserva_blancos_y_nulos(self):
        p = collect.compact_participants([fila(f'P{i}', 100 - i, i) for i in range(10)] + [fila('VOTOS NULOS', 5)], 3)
        self.assertEqual(len(p), 4)
        self.assertEqual(p[-1]['partido'], 'VOTOS NULOS')


class Contienda(unittest.TestCase):
    def partes(self, a, b):
        return collect.compact_participants([fila('A', a, 1), fila('B', b, 2), fila('VOTOS EN BLANCO', 99999)])

    def test_puede_cambiar_si_la_diferencia_cabe_en_lo_que_falta(self):
        c = collect.contienda({'totalActas': 100, 'contabilizadas': 90}, self.partes(5000, 3000))
        self.assertEqual(c['diferencia'], 2000)
        self.assertEqual(c['actasFaltan'], 10)
        self.assertEqual(c['votosMaxFaltan'], 3000)          # 10 actas × 300 electores
        self.assertTrue(c['puedeCambiar'])

    def test_ya_no_puede_cambiar(self):
        c = collect.contienda({'totalActas': 100, 'contabilizadas': 95}, self.partes(5000, 3000))
        self.assertEqual(c['votosMaxFaltan'], 1500)
        self.assertFalse(c['puedeCambiar'])

    def test_en_el_limite_todavia_puede_cambiar(self):
        c = collect.contienda({'totalActas': 100, 'contabilizadas': 90}, self.partes(6000, 3000))
        self.assertTrue(c['puedeCambiar'])                   # diferencia 3000 = máximo que falta: aún hay empate posible

    def test_sin_actas_contadas_no_afirma_nada_firme(self):
        c = collect.contienda({'totalActas': 100, 'contabilizadas': 0}, self.partes(0, 0))
        self.assertTrue(c['puedeCambiar'])

    def test_conteo_completo(self):
        c = collect.contienda({'totalActas': 100, 'contabilizadas': 100}, self.partes(10, 9))
        self.assertEqual(c['actasFaltan'], 0)
        self.assertFalse(c['puedeCambiar'])

    def test_sin_totales_no_calcula(self):
        c = collect.contienda({'totalActas': None, 'contabilizadas': 5}, self.partes(10, 9))
        self.assertNotIn('puedeCambiar', c)

    def test_el_primero_nunca_es_el_voto_en_blanco(self):
        c = collect.contienda({'totalActas': 10, 'contabilizadas': 5}, self.partes(10, 9))
        self.assertEqual(c['primero']['partido'], 'A')


class Boletin(unittest.TestCase):
    def test_texto(self):
        b = {'hora': '21:40', 'avance': [{'eleccion': 'Regional', 'actasPct': 37.21, 'antesPct': 33.1}],
             'cambios': [{'lugar': 'Cusco', 'eleccion': 'Alcalde Provincial'}], 'cambiosTotal': 1,
             'firmes': [{'nivel': 1, 'firmes': 4, 'conDatos': 25}],
             'observaciones': {'totales': 0, 'actasRevisadas': 1200, 'actasImportantes': 1, 'actasRevisar': 2}}
        t = collect.boletin_text(b)
        self.assertIn('Corte ONPE de las 21:40.', t)
        self.assertIn('Regional 37.2% (antes 33.1%)', t)
        self.assertIn('Cambió el primer lugar en 1 contienda: Cusco, alcalde provincial.', t)
        self.assertIn('en 4 de 25 regiones', t)
        self.assertIn('los totales cuadran; 1,200 actas revisadas, 3 con observaciones', t)

    def test_nombres(self):
        self.assertEqual(collect.nice('SAN JUAN DE LURIGANCHO'), 'San Juan de Lurigancho')
        self.assertEqual(collect.nice('LA LIBERTAD'), 'La Libertad')


if __name__ == '__main__':
    unittest.main()
