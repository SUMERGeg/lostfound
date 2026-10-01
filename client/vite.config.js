import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, new URL('.', import.meta.url).pathname, '')
  const yandexMapsApiKey = env.VITE_YANDEX_MAPS_API_KEY?.trim()

  return {
    server: {
      proxy: {
        '/api': {
          target: env.VITE_API_PROXY_TARGET?.trim() || 'http://127.0.0.1:8080',
          changeOrigin: true
        },
        '/health': {
          target: env.VITE_API_PROXY_TARGET?.trim() || 'http://127.0.0.1:8080',
          changeOrigin: true
        }
      }
    },
    plugins: [
      react(),
      {
        name: 'inject-yandex-maps-key',
        transformIndexHtml(html) {
          if (mode === 'demo' || env.VITE_DEMO_MODE === 'true') {
            return html.replace(/\s*<script src="https:\/\/api-maps\.yandex\.ru\/[^"]+" defer><\/script>/, '')
          }
          const query = yandexMapsApiKey
            ? `apikey=${encodeURIComponent(yandexMapsApiKey)}&`
            : ''

          return html.replace('__YANDEX_MAPS_QUERY__', query)
        }
      }
    ]
  }
})
