import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { signOut } from "@/lib/auth";
import Image from "next/image";
import MovieFact from "@/components/MovieFact";

export default async function DashboardPage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
  });

  if (!user?.favoriteMovie) {
    redirect("/onboarding");
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center px-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 w-full max-w-md shadow-xl space-y-6">

        {/* User Info */}
        <div className="flex items-center gap-4">
            {user.image ? (
            <Image
                src={user.image}
                alt="Profile photo"
                width={56}
                height={56}
                className="rounded-full border border-slate-700"
            />
            ) : (
            <div className="w-14 h-14 rounded-full border border-slate-700 bg-slate-800 flex items-center justify-center text-xl font-bold text-slate-400">
                {(user.name ?? user.email ?? "?")[0].toUpperCase()}
            </div>
            )}
          <div>
          <h2 className="text-xl font-bold">{user.name ?? user.email}</h2>
            <p className="text-slate-400 text-sm">{user.email}</p>
          </div>
        </div>

        <hr className="border-slate-800" />

        {/* Favorite Movie */}
        <div>
          <p className="text-slate-400 text-sm uppercase tracking-widest mb-1">
            Favorite Movie
          </p>
          <p className="text-2xl font-semibold">{user.favoriteMovie}</p>
        </div>

        <hr className="border-slate-800" />

        {/* Movie Fact */}
        <MovieFact movie={user.favoriteMovie} />

        <hr className="border-slate-800" />

        {/* Logout */}
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/" });
          }}
        >
          <button
            type="submit"
            className="w-full border border-slate-700 hover:bg-slate-800 text-slate-300 font-medium py-2.5 rounded-lg transition"
          >
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}