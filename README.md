# Eventia

Aplicación web progresiva persoal, local e centrada na galería visual de eventos. Emprega React, TypeScript, Vite, Dexie/IndexedDB e un service worker para instalarse no iPhone e funcionar sen conexión despois da primeira carga.

## Desenvolvemento

```sh
npm install
npm run dev
```

## Compilación

```sh
npm run build
npm run preview
```

## Publicación en GitHub Pages

O workflow de `.github/workflows/pages.yml` constrúe e publica `dist` ao facer push á rama `main`. Crea un repositorio público chamado `eventia`, sobe este proxecto á rama `main` e activa **Settings → Pages → GitHub Actions**. A compilación usa rutas relativas para funcionar en `https://<usuario>.github.io/eventia/`.

A páxina publicada será pública e non terá login. O código da aplicación estará visible, pero os eventos, portadas e documentos permanecen na IndexedDB local do navegador e non se soben a GitHub. GitHub Pages serve os ficheiros da app e o Service Worker almacénaos para uso sen conexión tras a primeira carga.

## Copias entre dispositivos

Serve a compilación desde HTTPS e engádea á pantalla de inicio desde Safari. Abre a mesma PWA no navegador do Mac para importar/exportar; cada dispositivo ten unha base independente. En Axustes podes exportar un JSON autocontido con eventos, categorías, axustes, recordatorios, portadas e anexos; impórtao no outro dispositivo despois de pasalo por AirDrop, cable ou o destino que escollas. Hai opción de fusionar ou substituír. Os ficheiros multimedia están limitados a 200 MB de orixe por copia para manter o uso de memoria viable en iPhone.

Eventia non ten backend, contas nin sincronización. A orixe HTTPS serve os ficheiros da aplicación; os datos persoais non se envían a esa orixe. O sistema solicita persistencia local cando está dispoñible, mais conserva copias manuais. Os recordatorios só se amosan cando Eventia está aberta; Safari non pode garantir alertas programadas coa PWA pechada.

Consulta `PROJECT_PLAN.md` para o estado e as limitacións de iOS.
