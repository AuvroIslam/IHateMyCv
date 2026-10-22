import { handleRouteError, jsonError } from '@/lib/api';
import { LATEX_MAX_BYTES, LatexError, compileLatex } from '@/lib/latex';
import { workspaceId } from '@/lib/workspace';

/** A LaTeX CV (.tex, or a project .zip) compiled to a PDF, for the upload to read like any other. */
export async function POST(request: Request) {
  try {
    await workspaceId(); // signed in
    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) return jsonError('Choose a .tex or .zip file.');
    if (!/\.(tex|zip)$/i.test(file.name)) return jsonError('Only .tex files and .zip projects can be compiled.');
    if (file.size > LATEX_MAX_BYTES) return jsonError('That file is too large. Keep LaTeX uploads under 8 MB.', 413);
    const pdf = await compileLatex(file.name, new Uint8Array(await file.arrayBuffer()));
    return new Response(Buffer.from(pdf), { headers: { 'content-type': 'application/pdf', 'cache-control': 'no-store' } });
  } catch (err) {
    if (err instanceof LatexError) return jsonError(err.message, 422);
    return handleRouteError(err);
  }
}
