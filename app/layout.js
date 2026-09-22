import './globals.css'

export const metadata = {
  title: 'Foundryman Jobs India',
  description: 'ITI Foundryman vacancies, apprenticeships, railway, defence and PSU opportunities in India.'
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
