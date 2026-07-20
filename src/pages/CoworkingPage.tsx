import React from 'react'
import PageWrapper from '../components/PageWrapper'
import HeroSection from '../components/HeroSection'
import ServicesSection from '../components/ServicesSection'
import TestimonialsSection from '../components/TestimonialsSection'
import ContactSection from '../components/ContactSection'

const CoworkingPage: React.FC = () => {
  return (
    <PageWrapper>
      <HeroSection variant="coworking" />
      <ServicesSection />
      <TestimonialsSection />
      <ContactSection />
    </PageWrapper>
  )
}

export default CoworkingPage