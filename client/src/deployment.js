export function getDeployment(mode = 'production', demoMode = '') {
  const useHashRouter = mode === 'pages'
  return {
    isDemo: useHashRouter || mode === 'demo' || demoMode === 'true',
    useHashRouter,
    base: useHashRouter ? '/lostfound/' : '/'
  }
}

export const deployment = getDeployment(import.meta.env?.MODE, import.meta.env?.VITE_DEMO_MODE)

export function assetUrl(path, base = import.meta.env?.BASE_URL || '/') {
  return `${base.replace(/\/?$/, '/')}${path.replace(/^\/+/, '')}`
}
