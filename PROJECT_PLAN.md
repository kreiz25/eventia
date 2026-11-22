# Eventia · arquitectura e execución

## Arquitectura acordada

- **Cliente:** React + TypeScript + Vite, empaquetado como PWA instalable desde Safari no iPhone.
- **Persistencia:** Dexie.js sobre IndexedDB, sen backend, contas nin sincronización. Base de datos versionada con `events`, `categories`, `attachments`, `reminders` e `settings`; os anexos gardaranse como `Blob`, relacionados por `eventId`. A portada e a súa miniatura son campos independentes dos anexos.
- **Datas:** almacenar día local como `YYYY-MM-DD` e hora como `HH:mm`, sen converter os eventos de día completo a UTC. Comparar o límite do arquivo usando o día local seguinte á data final (ou inicio), e executar unha operación idempotente ao abrir e ao volver a primeiro plano.
- **Offline:** precache dos recursos estáticos mediante service worker; os datos e medios viven en IndexedDB. A primeira instalación/publicación require conexión. Solicitar persistencia de almacenamento cando o navegador o permita e ofrecer exportación manual de copia completa e CSV.
- **Transferencia manual iPhone ↔ Mac:** usar a mesma PWA desde o navegador do Mac só para importar/exportar; cada navegador conserva unha IndexedDB distinta. Exportarase un JSON completo e autocontido, con versión, eventos, categorías, configuración, recordatorios e os Blobs codificados para restaurar portadas e anexos. A persoa move o ficheiro por AirDrop, cable ou un lugar de ficheiros que elixa; non hai sincronización automática nin datos de eventos enviados á orixe web.
- **Importación:** validar estrutura, versión e integridade antes de escribir. Amosar resumo e permitir fusión ou substitución. Na fusión, IDs estables evitan repetir eventos/anexos xa importados; ante unha modificación do mesmo rexistro, preguntar se conservar o actual ou substituílo polo da copia. A substitución require confirmación explícita e aplícase nunha transacción IndexedDB para evitar restauracións parciais. Categorías e referencias de anexos deben conservar as relacións.
- **PDF/compartición:** xerar PDF A4 no cliente e compartir o `File` mediante `navigator.canShare({files})`/`navigator.share`; cando non estea dispoñible, descargar o ficheiro. Nunca incluír anexos privados sen selección expresa.
- **Recordatorios:** sen servidor non existe unha vía PWA fiable para programar alertas locais cando iOS pecha a aplicación. A versión web só pode mostrar avisos cando Eventia está activa; a interface debe explicalo e conservar os datos do recordatorio para unha posible versión nativa futura.
- **Privacidade:** non integrar analítica, fontes, mapas nin recursos remotos. Apple Maps/Google Maps abriranse só tras unha acción expresa do usuario mediante URL externa.

## Etapas

1. **Estrutura e deseño (entregada nesta rama):** identidade, navegación e galería con contido ficticio; busca, categoría, período, lista/galería e fichas visuais.
2. **Xestión de eventos (implementada):** Dexie, eventos e categorías locais, alta/edición/eliminación, imaxes de portada locais, filtros e fichas. A copia e restauración JSON están integradas en Axustes para transferir manualmente os datos entre iPhone e Mac; falta completalas cos anexos cando se implemente a Etapa 3.
3. **Complementos (implementada):** anexos locais e descarga/visor, mapas externos a petición, axenda cronolóxica, arquivo automático idempotente e histórico con filtros.
4. **Exportación e avisos (implementada):** PDF A4 xerado no cliente, Web Share con descarga alternativa, copia/restauración JSON validada, CSV e recordatorios dentro da app activa.
5. **Consolidación:** verificar datas de día completo e varios días, cambios de zona, IndexedDB, medios, arquivo, backup, PDF, modo offline e iPhone real.

## Transferencia entre dispositivos

O fluxo esperado é: exportar a copia completa desde Eventia no iPhone, gardar o ficheiro no destino escollido e importalo manualmente en Eventia aberta no navegador do Mac. Se despois se modifica a copia do Mac, hai que exportala e importala de novo no iPhone; non hai fusión en tempo real nin fonte única automática. AirDrop evita gardar a copia nun servizo cloud; iCloud Drive só interviría se a persoa o escolle como destino.

## Estado da entrega

Etapas 1 a 4 implementadas no código. Probaron compilación PWA, creación/edición e persistencia local no navegador, arquivado manual, xestión de categorías e xeración dun PDF A4 válido. Pendentes de consolidación: ida e volta real dunha copia con medios, importación de ficheiros grandes, calendario de datas e zonas horarias, HEIC en Safari e instalación/mode offline nun iPhone físico.
