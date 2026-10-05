# Auditora Independiente Automatizada de Procesos Electorales · ERM 2026

Conteo de votos de las **Elecciones Regionales y Municipales 2026 del Perú** (domingo 4 de octubre de 2026), tomado de la ONPE, con verificaciones automáticas y todo en formato abierto.

**Dashboard en vivo:** https://peruvian.dev/dataonpe/

> Proyecto independiente. No recibe financiamiento de ningún partido, candidato, organización, medio ni empresa. Su único objetivo es que la data electoral publicada sea veraz y que cualquiera pueda comprobarlo.
>
> No hacemos proyecciones, conteos rápidos ni encuestas. La fuente oficial es siempre [resultadoelectoral.onpe.gob.pe](https://resultadoelectoral.onpe.gob.pe). Sitio no oficial, sin afiliación con la ONPE ni el JNE.

## Qué hay aquí

| Ruta | Qué contiene |
|---|---|
| `data/latest.json` | Resumen en vivo: cada elección con sus totales, candidatos y resultados por departamento. |
| `data/csv/eleccion-<id>-departamentos.csv` | Una fila por candidato y departamento. Se abre directo en Excel. |
| `data/series/eleccion-<id>.csv` | Cada corte nacional que publica la ONPE, con su hora exacta. |
| `data/ambitos/eleccion-<id>.json` | Resultados por provincia (alcalde provincial) o por distrito (alcalde distrital), con la hora en que se consultó cada lugar. |
| `data/ambitos/indice.json` | Lista de regiones, provincias y distritos (la usa el buscador «Mi zona»). |
| `data/boletines.json` | Boletín de cada corte: qué cambió entre un corte de la ONPE y el anterior. Lo arma el programa, sin IA. |
| `data/actas/` | Revisión acta por acta: avance (`resumen.json`) y observaciones (`anomalias.json`). |
| `data/onpe/` | **Respuestas originales de la ONPE**, sin tocar. |
| `data/manifest.json` | Para cada archivo crudo: URL de origen en la ONPE, cuándo cambió y su huella SHA-256. |
| `data/checks.json` | Observaciones vigentes en los totales. `data/checks-log.ndjson` guarda todas, con su hora. |
| `data/bots/` | Bitácora y cumplimiento de horario del equipo de bots de cobertura. |
| `collector/` | El colector (Python, solo librería estándar). |
| `bots/` | El exportador de la bitácora de los bots. |
| `app/` | Código del sitio: React + React Three Fiber (sala de control 3D). `npm run build` genera `web/`. |
| `web/` | El sitio publicado (generado desde `app/`). `live.html` es la vista para transmitir en vivo. |

Cada vez que la ONPE publica un corte nuevo, el colector hace un commit. **El historial de commits es el archivo histórico**: puedes ver cómo cambió cualquier número y cuándo.

## Cómo usar los datos

```bash
# Resumen en vivo
curl -s https://peruvian.dev/dataonpe/data/latest.json

# Todo, con el historial de cada corte
git clone https://github.com/fastestShipper/erm2026.git
cd erm2026
git log --oneline -- data/latest.json

# Cómo estaba un archivo en un corte anterior
git show <commit>:data/latest.json
```

```python
import requests
d = requests.get("https://peruvian.dev/dataonpe/data/latest.json").json()
for e in d["elecciones"]:
    t = e["totales"]
    print(e["nombre"], t.get("actasContabilizadas"), "% actas")
    for p in e["participantes"][:3]:
        print("  ", p["partido"], p["candidato"], p["votos"], p["pctValidos"])
```

Los nombres de los campos son los de la ONPE: `actasContabilizadas` (porcentaje), `contabilizadas` y `totalActas` (cantidad de actas), `participacionCiudadana`, `totalVotosEmitidos`, `totalVotosValidos` y `fechaActualizacion` (milisegundos Unix del corte de la ONPE). En `latest.json` los candidatos usan nombres cortos: `partido`, `candidato`, `votos`, `pctValidos` y `pctEmitidos`.

## Cómo se obtienen los números

1. El colector consulta cada minuto la API pública que usa el propio portal de la ONPE (`/presentacion-backend`), con pausas entre pedidos para no saturarla.
2. Guarda cada respuesta tal cual en `data/onpe/` y registra su huella en `manifest.json`.
3. Arma `latest.json` y los CSV **copiando** los campos de la ONPE, sin recalcular nada.
4. Corre las verificaciones y publica las observaciones con los dos números a la vista.
5. Si la ONPE no responde o todavía no publica, el dashboard lo dice. Nunca muestra cifras estimadas.

Los votos en blanco, nulos e impugnados van aparte (`especial`) y nunca cuentan como primer lugar. Los archivos derivados no copian el DNI de los candidatos; sigue en las respuestas originales de la ONPE.

Las provincias y los distritos (unos 1,900 lugares) los recorre un proceso aparte (`collect.py --ambitos`), en ronda y dando más turnos a los lugares con más actas. Cada lugar guarda la hora en que se consultó. Si la ONPE rechaza consultas, los recorridos largos se pausan solos; nunca se intenta saltar el bloqueo.

## Verificaciones automáticas

En cada corte se revisa que la data de la ONPE sea coherente consigo misma:

- La suma de votos de las organizaciones debe coincidir con `totalVotosValidos`.
- Cada porcentaje publicado debe coincidir con votos ÷ válidos (tolerancia de 0,06 puntos).
- Las actas contabilizadas no pueden superar el total de actas, ni los votos válidos a los emitidos.
- Los acumulados (actas y votos) no deben bajar entre un corte y el siguiente.

Una observación **no es una acusación**. Es una diferencia que vale la pena mirar y que cualquiera puede comprobar con los archivos crudos. Si dos pedidos seguidos caen a cada lado de una actualización de la ONPE, se repiten antes de anotar una diferencia.

## ¿Puede cambiar el primer lugar?

En cada contienda (gobernador de una región, alcalde de una provincia o de un distrito) se publica `contienda`: el primero, el segundo, la diferencia en votos y cuántas actas faltan. Cada mesa tiene como máximo 300 electores (Ley Orgánica de Elecciones, art. 52), así que en las actas que faltan no puede haber más de `actas que faltan × 300` votos. Si la diferencia es mayor que eso, `puedeCambiar` es `false`: el orden ya no cambia con lo que falta contar.

Es una cota calculada con las cifras de la ONPE. No es una proyección ni una proclamación: a los ganadores los proclama el Jurado Electoral, y en la elección regional hay segunda vuelta si nadie pasa el 30 % de los votos válidos.

## Boletín de cada corte

Cada vez que la ONPE publica un corte nuevo, el colector agrega un boletín a `data/boletines.json`: actas contadas por elección, en qué contiendas cambió el primer lugar, en cuántas ya no puede cambiar y cuántas observaciones hay. Es texto generado por el programa a partir de los datos, sin inteligencia artificial.

## API para agentes y periodistas

La ONPE bloquea las conexiones desde servidores en la nube (HTTP 403). Para quien no puede leerla directo (agentes de IA, redacciones, investigadores) hay una API de solo lectura sobre esta misma copia: https://peruvian.dev/dataonpe/api/v1/ (la guía está en esa dirección). No consulta a la ONPE: lee los archivos que publica el colector. Detalle de cada endpoint en [deploy/api/README.md](deploy/api/README.md).

## Cobertura en vivo (bots)

Un equipo de bots de IA sigue la jornada: el portal de la ONPE, las cuentas oficiales en X (ONPE, JNE y medios nacionales), la verificación de afirmaciones contra fuentes oficiales y la desinformación viral. Su bitácora se publica en `data/bots/feed.json`, y `data/bots/schedule.json` indica si cada bot está cumpliendo su horario.

Lo que publican los bots es trabajo en curso hecho por IA: **verifica siempre contra la fuente oficial que citan**. Las cifras del dashboard no vienen de los bots, sino directamente de la ONPE.

### Veda electoral

Hasta el cierre de la votación (17:00, hora de Lima) no se publica ningún mensaje de los bots que mencione candidatos, organizaciones políticas, encuestas, proyecciones, tendencias o cifras de votos. El filtro está en [`bots/veda.mjs`](bots/veda.mjs) y tiene sus pruebas en `bots/veda.test.mjs`. Los mensajes no se borran: quedan en espera y se publican solos al cierre, con su hora original. `feed.json` dice cuántos hay en espera.

Base: Ley Orgánica de Elecciones (arts. 190 y 191) y Reglamento sobre Encuestas Electorales del JNE (Res. 0107-2025-JNE). Este proyecto no hace ni difunde encuestas, proyecciones ni conteos rápidos, antes o después del cierre.

## Correr el colector tú mismo

```bash
git clone https://github.com/fastestShipper/erm2026.git && cd erm2026
ERM_PUSH=0 python3 collector/collect.py      # corte nacional y por región: escribe en data/
python3 collector/collect.py --ambitos       # provincias y distritos (se repite cada 2 minutos)
python3 -m http.server -d . 8000             # y abre http://localhost:8000/web/ (copia data/ dentro de web/)
```

Variables útiles: `ERM_DELAY` (pausa entre pedidos, 0.3 s por defecto), `ERM_AMBITOS_DELAY` (0.5 s) y `ERM_AMBITOS_BUDGET` (segundos por corrida del recorrido de provincias y distritos, 100 por defecto).

Pruebas: `node --test bots/veda.test.mjs` y `python3 -m unittest discover -s collector`.

## Créditos

- Personajes 3D: «RobotExpressive», de Tomás Laulhé (Quaternius), con cambios de Don McCurdy. Dominio público (CC0 1.0).
- Mapa de regiones: geoBoundaries (gbOpen, PER ADM1), dominio público, a partir de Wikimedia Commons. Simplificado para este sitio.

## Licencias

- Código: MIT.
- Datos derivados: CC BY 4.0. Cita «ERM 2026 · Datos abiertos» y la fuente original, la ONPE.
- Las respuestas de la ONPE son información pública del Estado peruano.

¿Encontraste un error? Abre un *issue* con el enlace al archivo y al corte. Las correcciones quedan anotadas en [ERRATAS.md](ERRATAS.md).
