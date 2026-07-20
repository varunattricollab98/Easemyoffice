import React from 'react'
import PageWrapper from '../components/PageWrapper'
import HeroSection from '../components/HeroSection'
import ServicesSection from '../components/ServicesSection'
import TestimonialsSection from '../components/TestimonialsSection'
import ContactSection from '../components/ContactSection'

const HomePage: React.FC = () => {
  return (
    <PageWrapper>
      <HeroSection />
      <ServicesSection />
      <TestimonialsSection />
      <ContactSection />
    </PageWrapper>
  )
}

export default HomePage