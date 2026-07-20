import React from 'react'
import { motion } from 'framer-motion'
import { Building2 } from 'lucide-react'

const LoadingScreen: React.FC = () => {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gradient-to-br from-primary-50 via-white to-accent-50">
      <div className="flex flex-col items-center">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5 }}
          className="relative"
        >
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
            className="absolute -inset-4 rounded-full border-4 border-primary-200 border-t-primary-600"
          />
          <div className="flex items-center justify-center w-20 h-20 bg-gradient-to-br from-primary-500 to-accent-500 rounded-3xl shadow-highlight">
            <Building2 className="w-10 h-10 text-white" />
          </div>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="mt-8 text-2xl font-display font-bold text-gray-900"
        >
          EaseMy<span className="gradient-text">Office</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-2 text-sm text-gray-500"
        >
          Premium Workspace Solutions
        </motion.p>

        <div className="mt-6 flex space-x-2">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              animate={{ y: [0, -8, 0] }}
              transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.15 }}
              className="w-2.5 h-2.5 rounded-full bg-primary-500"
            />
          ))}
        </div>
      </div>
    </div>
  )
}

export default LoadingScreen