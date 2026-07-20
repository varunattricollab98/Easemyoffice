import React from 'react'
import PageWrapper from '../components/PageWrapper'
import HeroSection from '../components/HeroSection'
import ServicesSection from '../components/ServicesSection'
import ContactSection from '../components/ContactSection'

const ServicesPage: React.FC = () => {
  return (
    <PageWrapper>
      <HeroSection
        title="Complete Business Compliance Services"
        subtitle="Company registration, GST, trademark, and end-to-end compliance handled by experts — so you can focus on growing your business."
      />
      <ServicesSection />
      <ContactSection />
    </PageWrapper>
  )
}

export default ServicesPage