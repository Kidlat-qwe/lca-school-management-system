/**
 * DepEd-style lesson plan letterhead.
 * LCA seal left · Republika / DepEd / Region / Division / School center · DepEd seal right.
 * Region & Division follow the branch; school name is fixed.
 */
import {
  LESSON_PLAN_DEPED_SEAL_SRC,
  LESSON_PLAN_SCHOOL_NAME_LETTERHEAD,
  resolveLessonPlanHeaderMeta,
} from './constants';

const gothicFont = {
  fontFamily: '"UnifrakturCook", "Old English Text MT", "Times New Roman", serif',
};

const letterSans = {
  fontFamily: 'Arial, Helvetica, "Segoe UI", sans-serif',
};

export default function LessonPlanHeader({ branch = null, showTitle = true }) {
  const meta = resolveLessonPlanHeaderMeta(branch);
  const { letterhead_region, letterhead_division_office } = meta;

  return (
    <div className="mb-[18px] w-full">
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center sm:gap-4 md:gap-6">
        <img
          src="/LCA-Icon.png"
          alt="Little Champions Academy"
          className="h-[96px] w-[96px] shrink-0 object-contain sm:h-[120px] sm:w-[120px] md:h-[140px] md:w-[140px]"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />

        <div className="flex min-w-0 flex-1 flex-col items-center text-center leading-tight text-[#111111]">
          <p
            className="m-0 text-[15px] sm:text-[17px] md:text-[19px]"
            style={{ ...gothicFont, fontWeight: 700 }}
          >
            Republika ng Pilipinas
          </p>
          <p
            className="m-0 mt-0.5 text-[18px] sm:text-[22px] md:text-[26px]"
            style={{ ...gothicFont, fontWeight: 700 }}
          >
            Department of Education
          </p>
          <p
            className="m-0 mt-1.5 text-[11px] font-bold tracking-wide sm:text-[12px] md:text-[13px]"
            style={letterSans}
          >
            {letterhead_region}
          </p>
          <p
            className="m-0 mt-0.5 text-[11px] font-bold tracking-wide sm:text-[12px] md:text-[13px]"
            style={letterSans}
          >
            {letterhead_division_office}
          </p>
          <p
            className="m-0 mt-0.5 text-[12px] font-bold tracking-wide sm:text-[13px] md:text-[14px]"
            style={letterSans}
          >
            {LESSON_PLAN_SCHOOL_NAME_LETTERHEAD}
          </p>
        </div>

        <img
          src={LESSON_PLAN_DEPED_SEAL_SRC}
          alt="Department of Education"
          className="h-[96px] w-[96px] shrink-0 object-contain sm:h-[120px] sm:w-[120px] md:h-[140px] md:w-[140px]"
        />
      </div>

      {showTitle ? (
        <h2
          className="mb-0 mt-4 text-center text-[18px] font-bold uppercase tracking-wide text-[#111111] underline decoration-2 underline-offset-4 sm:mt-5 sm:text-[20px]"
          style={letterSans}
        >
          Lesson Plan
        </h2>
      ) : null}
    </div>
  );
}
