# 🎄 Sorteo de Navidad — Amigo Invisible Familiar

Aplicación web estática diseñada para organizar el Amigo Invisible familiar en Navidad, lista para desplegar en **Vercel**.

## ✨ Características

- **Acceso con PIN:** Pantalla inicial con teclado numérico táctil (`2512` o `2026`).
- **Reglas estrictas garantizadas:**
  - Todos los participantes dan y reciben exactamente un regalo.
  - **Sin auto-regalos:** nadie puede tocarse a sí mismo.
  - **Sin cruce de parejas:**
    - Martín ↔ Valeria
    - Marcelo ↔ Julieta
    - Alicia ↔ Jorge
    - Marina (participación individual)
- **Experiencia Navideña:**
  - Nieve animada en Canvas, guirnalda de luces parpadeantes y paleta festiva (*Crimson Noel*, *Pine Green*, *Gold Glow*).
  - Caja de regalo 3D interactiva con animación de apertura, destellos dorados y melodía sintetizada con Web Audio API (sin archivos externos).
- **Panel de Organizador (`⚙️ Administrador`):**
  - Acceso con PIN maestro (`9999` o `2512`).
  - Permite ver la matriz completa, copiar enlaces directos de WhatsApp por persona (`?u=Nombre&p=2512&s=Semilla`) o sortear de nuevo con una nueva semilla.

## 🚀 Despliegue en Vercel

### Opción 1: Vercel CLI
```bash
cd "G:\Mi unidad\Apps\sorteo-navidad"
npx vercel --prod
```

### Opción 2: GitHub + Vercel
1. Subí esta carpeta a un repositorio en GitHub.
2. Importá el repositorio en [vercel.com](https://vercel.com).
3. Dejá *Framework Preset* en **Other** (sitio estático) y presioná **Deploy**.
