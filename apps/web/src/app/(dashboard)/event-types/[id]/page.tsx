import { EventTypeEditor } from "@/components/event-type-editor";
export const metadata = { title: "Edit event type" };
export default async function EditEventTypePage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <EventTypeEditor eventId={id} />; }
