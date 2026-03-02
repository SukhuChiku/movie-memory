import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const movie = body.movie?.trim();

  if (!movie || movie.length < 1) {
    return NextResponse.json({ error: "Movie name is required." }, { status: 400 });
  }

  if (movie.length > 100) {
    return NextResponse.json({ error: "Movie name too long." }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { favoriteMovie: movie },
  });

  return NextResponse.json({ success: true });
}