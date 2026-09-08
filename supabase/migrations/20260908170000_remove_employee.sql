-- Removing an employee a chef added by mistake.
--
-- work_days, task_declarations, presence_requests and presence_check_ins all
-- reference the profile with NO ACTION, so an employee who has declared anything
-- cannot be deleted: their declared production and presence proofs are company
-- records, not the employee's to take away. Rather than surface a raw foreign key
-- violation, that case is refused explicitly and the chef is told to suspend
-- instead, which the is_active toggle already does and which is reversible.
create function public.remove_employee(employee uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare target public.profiles;
begin
 if public.current_profile_role() is distinct from 'chef' then raise exception 'Chef account required'; end if;
 select * into target from public.profiles where id = employee for update;
 if not found or target.company_id is distinct from public.current_profile_company_id() then
   raise exception 'Employee not found';
 end if;
 if target.role is distinct from 'employee' then raise exception 'Only an employee can be removed'; end if;
 if exists (select 1 from public.work_days where employee_id = employee)
    or exists (select 1 from public.task_declarations where employee_id = employee)
    or exists (select 1 from public.presence_check_ins where employee_id = employee) then
   raise exception 'This employee has declared work. Suspend the account instead.';
 end if;
 -- profiles cascades from auth.users, so removing the account removes the sign-in
 -- too; leaving the auth user behind would let them rejoin with the company code.
 delete from auth.users where id = employee;
end $$;
revoke all on function public.remove_employee(uuid) from public, anon;
grant execute on function public.remove_employee(uuid) to authenticated;
