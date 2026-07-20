import React from 'react'
import { motion } from 'framer-motion'

interface PageWrapperProps {
  children: React.ReactNode
}

const PageWrapper: React.FC<PageWrapperProps> = ({ children }) => {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      {children}
    </motion.div>
  )
}

export default PageWrapper