# CustomsAI - Refactored Structure

## Overview
The CustomsAI application has been refactored into a component-based architecture for better maintainability and developer experience.

## File Structure

### Main Files
- `index.html` - Main entry point with component loader
- `styles.css` - All CSS styles organized by section
- `app.js` - JavaScript functionality organized by feature
- `panel.html` - Original monolithic file (backup: `panel.html.original`)

### Component Files
All components are located in the `components/` directory:

#### UI Components
- `navbar.html` - Navigation bar with status indicator
- `connection-cards.html` - WhatsApp and Telegram connection cards
- `whatsapp-modal.html` - QR code modal for WhatsApp connection
- `how-it-works.html` - Step-by-step instructions
- `memory-panel.html` - Context memory information panel
- `stats-grid.html` - Statistics cards display
- `settings-page.html` - Settings page with all configuration options
- `editor-modal.html` - Declaration editor modal

## Architecture Benefits

### 1. **Separation of Concerns**
- **HTML**: Structure only, no inline styles or scripts
- **CSS**: Organized by component with clear naming conventions
- **JavaScript**: Modular functions grouped by functionality

### 2. **Component-Based Design**
- Each UI element is a separate, reusable component
- Components can be developed and tested independently
- Easy to add, remove, or modify features

### 3. **Maintainability**
- **Reduced file size**: Main HTML is now ~50 lines vs 1500+ lines
- **Clear organization**: Related code is grouped together
- **Easy debugging**: Issues can be isolated to specific components

### 4. **Developer Experience**
- **Faster development**: Work on individual components
- **Better collaboration**: Multiple developers can work on different components
- **Code reusability**: Components can be reused across pages

## JavaScript Organization

The `app.js` file is organized into clear sections:

1. **Global State & Initialization**
2. **Page Navigation**
3. **Status Management**
4. **WhatsApp Connection**
5. **Settings Management**
6. **Telegram Management**
7. **Goods Management**
8. **Editor Modal**
9. **TNVED Search**
10. **Alerts & History**
11. **Phone Linking**

## CSS Organization

The `styles.css` file is organized with:
- CSS variables for consistent theming
- Logical sections with clear comments
- Responsive design considerations
- Component-specific styling

## Usage

### Development
1. Modify individual components in the `components/` directory
2. Update styles in `styles.css`
3. Add functionality to `app.js`

### Testing
1. Open `index.html` in a browser
2. Components are loaded automatically via JavaScript
3. Check browser console for any component loading errors

### Deployment
The refactored application maintains the same API endpoints and functionality as the original, so no backend changes are required.

## Migration Notes

- Original `panel.html` is preserved as backup
- All functionality remains intact
- Same API endpoints are used
- No breaking changes to the backend

## Future Enhancements

With this component-based structure, you can now easily:
- Add new pages by creating new components
- Implement a proper build system (Webpack, Vite, etc.)
- Add TypeScript support
- Implement proper component testing
- Add state management (Redux, Zustand, etc.)
- Create reusable component library
