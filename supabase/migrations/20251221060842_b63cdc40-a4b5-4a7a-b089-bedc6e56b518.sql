-- Add unique constraint for user_progress upsert
ALTER TABLE public.user_progress DROP CONSTRAINT IF EXISTS user_progress_user_module_unique;
ALTER TABLE public.user_progress ADD CONSTRAINT user_progress_user_module_unique UNIQUE (user_id, module_id);

-- Add DELETE policy for education_modules so admins can delete
DROP POLICY IF EXISTS "Admins can delete modules" ON public.education_modules;
CREATE POLICY "Admins can delete modules" 
ON public.education_modules 
FOR DELETE 
USING (has_role(auth.uid(), 'admin'::app_role));