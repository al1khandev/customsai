# Phone Number Linking Feature

## Overview
This feature allows users to optionally save their WhatsApp phone number during the connection process. It provides an alternative way to track which phone is connected to the bot.

## Usage

### For Users
1. Open the bot panel at `http://localhost:3000` (or your deployment URL)
2. Go to **Подключение** (Connection) page
3. When waiting for QR code scan, click **"📱 Or enter phone number"**
4. Enter your phone number with country code (e.g., `+77012345678`)
5. Click **"📱 Save Number"**
6. Scan the QR code to complete authentication

### Storage
- Phone numbers are saved in `settings.json`
- Persistent across bot restarts
- Used for reference and tracking only

## API Reference

### POST /link-phone
Save a phone number for the connected account.

**Request:**
```json
{
  "phone": "+77012345678"
}
```

**Response (Success):**
```json
{
  "ok": true,
  "phone": "77012345678",
  "message": "Номер сохранён. Отсканируйте QR-код на вашем телефоне для подтверждения."
}
```

**Response (Error):**
```json
{
  "ok": false,
  "error": "Некорректный номер телефона"
}
```

### GET /get-linked-phone
Retrieve the linked phone number.

**Response:**
```json
{
  "phone": "77012345678",
  "connected": "77012345678"
}
```

## Technical Details

### Frontend (panel.html)
- **togglePhoneForm()** - Toggle visibility of phone input form
- **linkPhoneNumber()** - Validate and send phone to backend
- **renderConnect()** - Updated to show phone option when waiting for QR

### Backend (bot.restored.js)
- **POST /link-phone** - Accept phone, validate, save to settings
- **GET /get-linked-phone** - Return saved phone number

### Phone Number Format
- Requires minimum 10 digits
- Strips all non-numeric characters
- Stored as digits only (no formatting)

## Notes

- Phone number is **optional** - QR code scanning still works without it
- Phone is saved only when explicitly requested via the form
- WhatsApp connection method remains unchanged (still uses QR code)
- Feature is purely informational/tracking

## Examples

### Saving a Kazakhstan phone
```
Input: +77012345678 or 77012345678 or 7-701-234-5678
Saved as: 77012345678
```

### With other country codes
```
+15551234567 → 15551234567 (USA)
+44201234567 → 44201234567 (UK)
+861234567890 → 861234567890 (China)
```

## Troubleshooting

**"Некорректный номер телефона"**
- Phone number has too few digits
- Make sure to include country code
- Example: +77012345678 (not just 0701234567)

**Phone not saved**
- Check browser console for errors
- Verify backend is running
- Ensure settings.json is writable

**Need to change phone**
- Disconnect WhatsApp and reconnect
- Can save new phone on next connection
