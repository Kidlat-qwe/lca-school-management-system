BEGIN;

-- Create promostbl (Main Promo Table)
CREATE TABLE IF NOT EXISTS public.promostbl
(
    promo_id serial NOT NULL,
    promo_name character varying(255) COLLATE pg_catalog."default" NOT NULL,
    package_id integer NOT NULL,
    branch_id integer,
    promo_type character varying(50) COLLATE pg_catalog."default" NOT NULL,
    discount_percentage numeric(5, 2),
    discount_amount numeric(10, 2),
    min_payment_amount numeric(10, 2),
    start_date date NOT NULL,
    end_date date NOT NULL,
    max_uses integer,
    current_uses integer DEFAULT 0,
    eligibility_type character varying(50) COLLATE pg_catalog."default" DEFAULT 'all',
    status character varying(50) COLLATE pg_catalog."default" DEFAULT 'Active',
    description text COLLATE pg_catalog."default",
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    created_by integer,
    CONSTRAINT promostbl_pkey PRIMARY KEY (promo_id),
    CONSTRAINT promostbl_package_id_fkey FOREIGN KEY (package_id)
        REFERENCES public.packagestbl (package_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE NO ACTION,
    CONSTRAINT promostbl_branch_id_fkey FOREIGN KEY (branch_id)
        REFERENCES public.branchestbl (branch_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE NO ACTION,
    CONSTRAINT promostbl_created_by_fkey FOREIGN KEY (created_by)
        REFERENCES public.userstbl (user_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE NO ACTION
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_promo_package_id ON public.promostbl(package_id);
CREATE INDEX IF NOT EXISTS idx_promo_branch_id ON public.promostbl(branch_id);
CREATE INDEX IF NOT EXISTS idx_promo_status ON public.promostbl(status);
CREATE INDEX IF NOT EXISTS idx_promo_dates ON public.promostbl(start_date, end_date);

-- Add comments
COMMENT ON TABLE public.promostbl IS 'Stores promotional offers that can be applied to packages';
COMMENT ON COLUMN public.promostbl.promo_type IS 'Type: percentage_discount, fixed_discount, free_merchandise, or combined';
COMMENT ON COLUMN public.promostbl.branch_id IS 'NULL = all branches, specific ID = branch-specific promo';
COMMENT ON COLUMN public.promostbl.eligibility_type IS 'all, new_students_only, existing_students_only, or referral_only';
COMMENT ON COLUMN public.promostbl.max_uses IS 'Maximum number of students who can avail (NULL = unlimited)';

-- Create promomerchandisetbl (Free Merchandise for Promos)
CREATE TABLE IF NOT EXISTS public.promomerchandisetbl
(
    promomerchandise_id serial NOT NULL,
    promo_id integer NOT NULL,
    merchandise_id integer NOT NULL,
    quantity integer DEFAULT 1,
    CONSTRAINT promomerchandisetbl_pkey PRIMARY KEY (promomerchandise_id),
    CONSTRAINT promomerchandisetbl_promo_id_fkey FOREIGN KEY (promo_id)
        REFERENCES public.promostbl (promo_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT promomerchandisetbl_merchandise_id_fkey FOREIGN KEY (merchandise_id)
        REFERENCES public.merchandisestbl (merchandise_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE NO ACTION
);

CREATE INDEX IF NOT EXISTS idx_promomerchandise_promo_id ON public.promomerchandisetbl(promo_id);
CREATE INDEX IF NOT EXISTS idx_promomerchandise_merchandise_id ON public.promomerchandisetbl(merchandise_id);

COMMENT ON TABLE public.promomerchandisetbl IS 'Stores free merchandise items included in promos';
COMMENT ON COLUMN public.promomerchandisetbl.quantity IS 'How many of this item to give for free';

-- Create promousagetbl (Track Promo Usage)
CREATE TABLE IF NOT EXISTS public.promousagetbl
(
    promousage_id serial NOT NULL,
    promo_id integer NOT NULL,
    student_id integer NOT NULL,
    invoice_id integer NOT NULL,
    used_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    discount_applied numeric(10, 2),
    CONSTRAINT promousagetbl_pkey PRIMARY KEY (promousage_id),
    CONSTRAINT promousagetbl_promo_id_fkey FOREIGN KEY (promo_id)
        REFERENCES public.promostbl (promo_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE NO ACTION,
    CONSTRAINT promousagetbl_student_id_fkey FOREIGN KEY (student_id)
        REFERENCES public.userstbl (user_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE NO ACTION,
    CONSTRAINT promousagetbl_invoice_id_fkey FOREIGN KEY (invoice_id)
        REFERENCES public.invoicestbl (invoice_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE NO ACTION,
    CONSTRAINT promousagetbl_unique_student_promo UNIQUE (promo_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_promousage_promo_id ON public.promousagetbl(promo_id);
CREATE INDEX IF NOT EXISTS idx_promousage_student_id ON public.promousagetbl(student_id);
CREATE INDEX IF NOT EXISTS idx_promousage_invoice_id ON public.promousagetbl(invoice_id);

COMMENT ON TABLE public.promousagetbl IS 'Tracks which students have used which promos';
COMMENT ON COLUMN public.promousagetbl.discount_applied IS 'Actual discount amount applied to the invoice';

-- Create referralstbl (Student Referral Tracking)
CREATE TABLE IF NOT EXISTS public.referralstbl
(
    referral_id serial NOT NULL,
    referrer_student_id integer NOT NULL,
    referred_student_id integer NOT NULL,
    referral_code character varying(50) COLLATE pg_catalog."default",
    referred_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    status character varying(50) COLLATE pg_catalog."default" DEFAULT 'Pending',
    CONSTRAINT referralstbl_pkey PRIMARY KEY (referral_id),
    CONSTRAINT referralstbl_referrer_student_id_fkey FOREIGN KEY (referrer_student_id)
        REFERENCES public.userstbl (user_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE NO ACTION,
    CONSTRAINT referralstbl_referred_student_id_fkey FOREIGN KEY (referred_student_id)
        REFERENCES public.userstbl (user_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE NO ACTION,
    CONSTRAINT referralstbl_unique_referred UNIQUE (referred_student_id)
);

CREATE INDEX IF NOT EXISTS idx_referral_referrer ON public.referralstbl(referrer_student_id);
CREATE INDEX IF NOT EXISTS idx_referral_referred ON public.referralstbl(referred_student_id);
CREATE INDEX IF NOT EXISTS idx_referral_status ON public.referralstbl(status);
CREATE INDEX IF NOT EXISTS idx_referral_code ON public.referralstbl(referral_code);

COMMENT ON TABLE public.referralstbl IS 'Tracks student referrals for promo eligibility';
COMMENT ON COLUMN public.referralstbl.status IS 'Pending, Verified, or Used';

COMMIT;

