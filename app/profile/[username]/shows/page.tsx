import { redirect } from 'next/navigation'

interface PageProps {
  params: Promise<{ username: string }>
}

export default async function ProfilePage({ params }: PageProps) {
  const { username } = await params
  redirect(`/profile/${username}/shows`)
}
