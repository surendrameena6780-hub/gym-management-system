import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const permissionsPolicyHeader = [
  'accelerometer=(self "https://api.razorpay.com")',
  'gyroscope=(self "https://api.razorpay.com")',
  'magnetometer=(self "https://api.razorpay.com")',
  'payment=(self "https://api.razorpay.com")',
].join(', ')

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_BUILD_ID__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    headers: {
      'Permissions-Policy': permissionsPolicyHeader,
    },
  },
  preview: {
    headers: {
      'Permissions-Policy': permissionsPolicyHeader,
    },
  },
})
