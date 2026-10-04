# ERM 2026 · Datos abiertos

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
| `data/ambitos/eleccion-<id>.json` | Resultados por provincia y distrito (elecciones municipales). |
| `data/onpe/` | **Respuestas originales de la ONPE**, sin tocar. |
| `data/manifest.json` | Para cada archivo crudo: URL de origen en la ONPE, cuándo cambió y su huella SHA-256. |
| `data/checks.json` | Verificaciones del último corte. `data/checks-log.ndjson` guarda todos los avisos. |
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

1. El colector consulta cada 2 minutos la API pública que usa el propio portal de la ONPE (`/presentacion-backend`), con pausas entre pedidos para no saturarla.
2. Guarda cada respuesta tal cual en `data/onpe/` y registra su huella en `manifest.json`.
3. Arma `latest.json` y los CSV **copiando** los campos de la ONPE, sin recalcular nada.
4. Corre las verificaciones y publica los avisos con los dos números a la vista.
5. Si la ONPE no responde o todavía no publica, el dashboard lo dice. Nunca muestra cifras estimadas.

Los resultados por provincia y distrito se recorren por tandas (unos 80 ámbitos por corrida), así que tardan en completarse.

## Verificaciones automáticas

En cada corte se revisa que la data de la ONPE sea coherente consigo misma:

- La suma de votos de las organizaciones debe coincidir con `totalVotosValidos`.
- Cada porcentaje publicado debe coincidir con votos ÷ válidos (tolerancia de 0,06 puntos).
- Las actas contabilizadas no pueden superar el total de actas, ni los votos válidos a los emitidos.
- Los acumulados (actas y votos) no deben bajar entre un corte y el siguiente.

Un aviso **no es una acusación**. Es una diferencia que vale la pena mirar y que cualquiera puede comprobar con los archivos crudos.

## Cobertura en vivo (bots)

Un equipo de bots de IA sigue la jornada: el portal de la ONPE, las cuentas oficiales en X (ONPE, JNE y medios nacionales), la verificación de afirmaciones contra fuentes oficiales y la desinformación viral. Su bitácora se publica en `data/bots/feed.json`, y `data/bots/schedule.json` indica si cada bot está cumpliendo su horario.

Lo que publican los bots es trabajo en curso hecho por IA: **verifica siempre contra la fuente oficial que citan**. Las cifras del dashboard no vienen de los bots, sino directamente de la ONPE.

## Correr el colector tú mismo

```bash
git clone https://github.com/fastestShipper/erm2026.git && cd erm2026
ERM_PUSH=0 python3 collector/collect.py      # escribe en data/
python3 -m http.server -d . 8000             # y abre http://localhost:8000/web/ (copia data/ dentro de web/)
```

Variables útiles: `ERM_DELAY` (pausa entre pedidos, 0.3 s por defecto) y `ERM_DISTRICT_BUDGET` (pedidos por corrida para provincias y distritos).

## Créditos

- Personajes 3D: «RobotExpressive», de Tomás Laulhé (Quaternius), con cambios de Don McCurdy. Dominio público (CC0 1.0).

## Licencias

- Código: MIT.
- Datos derivados: CC BY 4.0. Cita «ERM 2026 · Datos abiertos» y la fuente original, la ONPE.
- Las respuestas de la ONPE son información pública del Estado peruano.

¿Encontraste un error? Abre un *issue* con el enlace al archivo y al corte.
