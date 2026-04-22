import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

const appBase = process.env.VITE_APP_BASE || '/'

export default defineConfig({
  base: appBase,
  plugins: [
    react({
      jsxRuntime: 'automatic',
      // Fast refresh for development
      fastRefresh: true
    })
  ],
  resolve: {
    aliases: {
      '@': resolve(__dirname, 'src'),
      '@components': resolve(__dirname, 'src/components'),
      '@features': resolve(__dirname, 'src/features'),
      '@services': resolve(__dirname, 'src/services'),
      '@utils': resolve(__dirname, 'src/utils'),
      '@styles': resolve(__dirname, 'src/styles')
    }
  },
  build: {
    // Target modern browsers for better optimization
    target: 'es2020',
    
    // Enable source maps for debugging
    sourcemap: true,
    
    // Optimize chunks for better caching
    rollupOptions: {
      output: {
        // Manual chunk splitting for better caching
        manualChunks: {
          // Vendor libraries
          vendor: ['react', 'react-dom', 'react-router-dom'],
          
          // UI components library
          ui: [
            // Add any UI component libraries here
            // 'lucide-react',
            // 'recharts'
          ],
          
          // Chart libraries (if any)
          charts: [
            // 'recharts',
            // 'd3'
          ],
          
          // Utility libraries
          utils: [
            'date-fns',
            'lodash-es'
          ],
          
          // API and data fetching
          api: [
            // Any API-related libraries
          ]
        },
        
        // Optimize chunk naming for better caching
        chunkFileNames: (chunkInfo) => {
          const facadeModuleId = chunkInfo.facadeModuleId ? chunkInfo.facadeModuleId.split('/').pop().replace('.jsx', '') : 'chunk'
          return `js/[name]-[hash].js`
        },
        
        entryFileNames: 'js/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          const extType = assetInfo.name.split('.').pop()
          if (/\.(mp4|webm|ogg|mp3|wav|flac|aac)(\?.*)?$/i.test(assetInfo.name)) {
            return `media/[name]-[hash][extname]`
          }
          if (/\.(png|jpe?g|gif|svg|tiff|bmp|ico)(\?.*)?$/i.test(assetInfo.name)) {
            return `images/[name]-[hash][extname]`
          }
          if (/\.(woff2?|eot|ttf|otf)(\?.*)?$/i.test(assetInfo.name)) {
            return `fonts/[name]-[hash][extname]`
          }
          return `${extType}/[name]-[hash][extname]`
        }
      }
    },
    
    // Optimize dependencies
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react-router-dom'
      ],
      exclude: [
        // Exclude large dependencies from pre-bundling
        // 'd3',
        // 'recharts'
      ]
    },
    
    // Minification options
    minify: 'terser',
    terserOptions: {
      compress: {
        // Remove console logs in production
        drop_console: true,
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.info', 'console.debug', 'console.warn']
      },
      mangle: {
        // Keep class names for debugging
        keep_classnames: false,
        keep_fnames: false
      }
    },
    
    // Report compressed size for better analysis
    reportCompressedSize: true,
    
    // Set chunk size warning limit
    chunkSizeWarningLimit: 1000
  },
  
  // Development server configuration
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    },
    // Enable HMR
    hmr: {
      overlay: true
    }
  },
  
  // Preview server configuration
  preview: {
    port: 4173,
    host: true
  },
  
  // Test configuration
  test: {
    globals: true,
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
      include: ['src/**/*.{js,jsx}'],
      exclude: [
        'src/test/**',
        'src/**/*.test.{js,jsx}',
        'src/**/*.spec.{js,jsx}'
      ]
    },
    setupFiles: ['./src/test/setup.ts']
  },
  
  // CSS optimization
  css: {
    // Enable CSS modules
    modules: {
      localsConvention: 'camelCase'
    },
    
    // PostCSS configuration
    postcss: {
      plugins: [
        // Add any PostCSS plugins here
        // 'autoprefixer',
        // 'cssnano'
      ]
    },
    
    // Enable CSS code splitting
    devSourcemap: true
  },
  
  // Environment variables
  define: {
    // Strip development-only code
    __DEV__: JSON.stringify(process.env.NODE_ENV !== 'production')
  },
  
  // Experimental features
  experimental: {
    // Enable build optimizations
    renderBuiltUrl: (filename, { hostType }) => {
      if (hostType === 'fs') {
        return { relative: true }
      } else {
        return { relative: false }
      }
    }
  }
})
