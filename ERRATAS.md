# Fe de erratas

Si publicamos algo equivocado, lo corregimos a la vista de todos y lo anotamos aquí: qué estaba mal, desde cuándo, cuándo se corrigió y cómo se puede comprobar.

Para reportar un error, [abre un aviso](https://github.com/fastestShipper/erm2026/issues/new?labels=errata) con el enlace o la captura de lo que viste y la fuente oficial que lo contradice. Se revisa contra la ONPE o el JNE.

## Correcciones

### 2026-10-05 · El «alcalde distrital» mostraba la elección provincial
- Qué se publicó: en la contienda «Alcalde distrital» (id 303: `data/ambitos/eleccion-303*`, `data/ambitos/contiendas.json`, `data/csv/eleccion-303-departamentos.csv`, `data/series/eleccion-303.csv` y «Mi zona»), cada distrito mostraba los votos de la elección de **alcalde provincial** en ese distrito, no los de su alcalde distrital. También se listaban como distritos los cercados, que eligen solo alcalde provincial.
- Qué era lo correcto (con fuente oficial): el portal de la ONPE consulta las municipales con dos ids: 3 para alcalde provincial y 4 para alcalde distrital. Se pedía todo con el 3. Por ejemplo, en La Tinguiña (Ica) el id 3 da primero a José Luis Gálvez Chávez, candidato a la alcaldía provincial de Ica; el id 4 da a los candidatos a la alcaldía distrital de La Tinguiña. Fuente: [resultadoelectoral.onpe.gob.pe](https://resultadoelectoral.onpe.gob.pe/main/elecciones-municipales).
- Desde cuándo y hasta cuándo estuvo mal: desde el primer corte publicado (4 de octubre, 17:06) hasta esta corrección (5 de octubre). Los datos de alcalde provincial y de gobernador regional no se vieron afectados. Las respuestas originales de la ONPE guardadas en `data/onpe/eleccion-3/dist-*` son correctas para lo que se pidió: la elección provincial por distrito.
- Cómo se corrigió (commit): el colector consulta el alcalde distrital con el id 4 y rehace desde cero su lista de lugares y su recorrido. Se retiraron la serie y los primeros lugares anteriores de esa contienda para no anunciar falsos cambios de primer lugar. Commit «colector: alcalde distrital con el id 4 de la ONPE».

<!--
Formato de cada entrada:

### 2026-10-04 21:40 · Título corto
- Qué se publicó:
- Qué era lo correcto (con fuente oficial):
- Desde cuándo y hasta cuándo estuvo mal:
- Cómo se corrigió (commit):
-->
