# API de solo lectura · ERM 2026 (copia no oficial)

Sirve **nuestra copia** de los resultados de las Elecciones Regionales y Municipales 2026. Un colector en una conexión peruana copia los resultados de la ONPE cada minuto a archivos JSON; esta API solo lee esos archivos. **No consulta a la ONPE** ni a ningún otro sitio: no es un proxy. Existe porque la ONPE bloquea las IP de la nube (403) y los agentes de IA no pueden leerla directamente.

Sitio no oficial. Los resultados oficiales son los que publica la ONPE.

Base: `https://peruvian.dev/dataonpe/api/v1`

```bash
BASE=https://peruvian.dev/dataonpe/api/v1
```

## Reglas generales

- **Siempre HTTP 200.** Los errores llegan como `{"ok":false,"error":"mensaje en español"}`. Revisa `ok`, no el código HTTP.
- Solo `GET` y `HEAD`. Cualquier otro método devuelve `{"ok":false,"error":"solo GET"}`.
- Respuesta correcta (el sobre):

```json
{
  "ok": true,
  "fuente": "ONPE (resultadoelectoral.onpe.gob.pe)",
  "copia": "peruvian.dev/dataonpe — copia no oficial, tomada cada minuto desde una conexión peruana",
  "aviso": "Sitio no oficial. Los resultados oficiales son los que publica la ONPE.",
  "consultado": "2026-10-04T06:11:39-05:00",
  "estado": "en-vivo",
  "data": { }
}
```

- `estado` es `esperando`, `en-vivo`, `bloqueado` o `error`. Si no es `en-vivo`, los datos son los últimos que se copiaron y pueden estar atrasados. `consultado` es la última vez que nuestro colector miró la ONPE.
- Las horas `corte` / `hora` son hora de Lima (`HH:MM`).
- Las listas largas se recortan y llevan `"truncado": true`.
- Los votos en blanco y nulos (`especial`) nunca cuentan como "primero". Aparecen aparte, como `especiales`.
- Cabeceras: `content-type: application/json; charset=utf-8`, `cache-control: no-store`, `access-control-allow-origin: *`.
- Se aceptan las rutas con y sin el prefijo `/dataonpe/api/v1`.
- Las tildes y la ñ van codificadas en la URL (`ñ` = `%C3%B1`). Con curl usa `-G --data-urlencode`.

## Endpoints

### `GET /`
Guía: lista de endpoints con descripción y ejemplo.

```bash
curl -s "$BASE/"
```

### `GET /estado`
Estado de la copia y avance de actas por elección. `resultados` es `true` solo si `estado` es `en-vivo`.

```bash
curl -s "$BASE/estado"
```

### `GET /resumen`
Por elección: `id`, `nombre`, `cargo`, `nivel`, `tipo`, `totales`, `corte` y los 5 primeros a nivel nacional (sin blancos ni nulos). Incluye el texto del último boletín.

```bash
curl -s "$BASE/resumen"
```

### `GET /eleccion/{id}`
Una elección (por ejemplo `20` gobernador, `21` consejeros, `22` alcalde provincial, `23` alcalde distrital) con sus departamentos. Cada departamento trae `ubigeo`, `nombre`, `actasContabilizadas`, `primero`, `segundo` y `puedeCambiar`. Con `?detalle=1` agrega los 10 primeros de cada departamento.

```bash
curl -s "$BASE/eleccion/20"
curl -s "$BASE/eleccion/20?detalle=1"
```

### `GET /lugar?q={texto}`
Busca regiones, provincias y distritos por nombre. No importan las tildes ni las mayúsculas; primero salen los que empiezan igual. Máximo 10 (`truncado` si hay más). `q` va de 1 a 40 caracteres; si son solo dígitos busca por prefijo de ubigeo. Cada resultado trae `nivel`, `ubigeo`, `nombre`, `ruta` ("Distrito, Provincia, Región") y `ver`.

```bash
curl -s -G "$BASE/lugar" --data-urlencode "q=cañete"
```

### `GET /lugar/{nivel}/{ubigeo}`
Todas las contiendas de un lugar. `nivel`: 1 región, 2 provincia, 3 distrito. `ubigeo`: 6 dígitos.

- Distrito: alcalde distrital, alcalde provincial de su provincia y gobernador regional de su región (el gobernador no se incluye para Lima Metropolitana, provincia `140100`).
- Provincia: alcalde provincial y gobernador.
- Región: gobernador.

Cada contienda trae `cargo`, `lugar`, `totales`, `corte`, `top` (5 primeros), `especiales` (blancos y nulos), `contienda` (primero, segundo, diferencia, actas que faltan, `puedeCambiar`) y `visto`. Si aún no tenemos los datos, la contienda lleva `"pendiente": true` y un mensaje. Si el lugar no está en nuestra copia, la respuesta lleva `"pendiente": true` y `contiendas: []`.

```bash
curl -s "$BASE/lugar/3/140102"
```

### `GET /mesa/{codigo}`
La mesa (exactamente 6 dígitos) con sus actas y sus observaciones. Si no la tenemos, o sus datos tienen más de 20 minutos, **y** la copia está `en-vivo`, la mesa se agrega a la cola de prioridad del colector y la respuesta trae `"enCola": true` y `"mensaje": "Se pidió; vuelve a consultar en unos minutos"`. Vuelve a consultar pasados unos minutos.

Límites de la cola (para ser justos con todos): 20 mesas nuevas por hora por cliente, 120 por hora en total, 300 pendientes como máximo (se descarta la más vieja) y cada pedido caduca a las 2 horas. Si se pasa el límite igual responde 200, con `"enCola": false` y un mensaje amable. No se guardan IP: el cliente es un hash con sal al azar que solo vive en memoria.

```bash
curl -s "$BASE/mesa/000007"
```

### `GET /observaciones?severidad={alerta|revisar}&limite={1-50}`
Observaciones de actas (las más nuevas primero), observaciones a nivel de totales y los conteos de `actas/resumen`. `severidad` y `limite` son opcionales (`limite` por defecto 20).

```bash
curl -s "$BASE/observaciones?severidad=alerta&limite=10"
```

### `GET /boletines?limite={1-50}`
Últimos boletines, generados por programa con los datos oficiales (no son proyecciones). Por defecto 5. De cada boletín se muestran hasta 5 `cambios`; `cambiosTotal` dice cuántos hubo.

```bash
curl -s "$BASE/boletines?limite=3"
```

### `GET /cola`
Mesas pedidas, para que **nuestro colector** las priorice. Es un `data` con `pedidas` (códigos de 6 dígitos, de la más vieja a la más nueva) y `actualizado`.

```bash
curl -s "$BASE/cola"
```

## Validación de entradas

| Entrada | Regla |
|---|---|
| `mesa` | exactamente 6 dígitos |
| `ubigeo` | exactamente 6 dígitos |
| `nivel` | `1`, `2` o `3` |
| id de elección | solo dígitos, hasta 4 |
| `q` | 1 a 40 letras, números, espacios o `.,'()-` |
| `limite` | entero de 1 a 50 |
| `severidad` | `alerta` o `revisar` |

Ninguna entrada se usa para armar rutas de archivos.

## Ejecutar

```bash
PORT=8834 DATA_DIR=/srv/erm2026/data MESAS_DIR=/srv/erm2026-mesas STATE_DIRECTORY=./state node server.mjs
```

Node 20 o más nuevo, sin dependencias. Escucha solo en `127.0.0.1`; nginx enruta `https://peruvian.dev/dataonpe/api/v1/*` hacia `127.0.0.1:8834`.

- `DATA_DIR`: `status.json`, `latest.json`, `boletines.json`, `checks.json`, `ambitos/`, `actas/resumen.json`, `actas/anomalias.json`.
- `MESAS_DIR`: `<primeros 3 dígitos>.json` con las mesas.
- `STATE_DIRECTORY`: dónde se guarda `cola.json` (por defecto `./state`). systemd lo define con `StateDirectory=erm2026-api`.
- Los archivos se guardan en memoria y se vuelven a leer cuando cambia su fecha de modificación, mirando como mucho una vez cada 5 segundos. Si un archivo falta o no se puede leer, se trata como vacío.

## Instalar con systemd

```bash
sudo install -d /opt/erm2026-api
sudo install -m 644 server.mjs /opt/erm2026-api/server.mjs
sudo install -m 644 erm2026-api.service /etc/systemd/system/erm2026-api.service
sudo systemctl daemon-reload && sudo systemctl enable --now erm2026-api
curl -s http://127.0.0.1:8834/estado
```

Los directorios de datos deben poder leerse por cualquier usuario (el servicio corre con `DynamicUser`).

## Pruebas

```bash
cd deploy/api
node --test
```

Las pruebas usan los datos de `local/testroot/data` (solo lectura; si cambian algo, trabajan sobre una copia temporal). Se pueden apuntar a otros datos con `FIXTURE_DATA_DIR` y `FIXTURE_MESAS_DIR`.
