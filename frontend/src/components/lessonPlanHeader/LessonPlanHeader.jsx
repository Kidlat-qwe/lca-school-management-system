import {
  LESSON_PLAN_HEADER_META,
  LESSON_PLAN_SCHOOL_ADDRESS,
  LESSON_PLAN_SCHOOL_NAME,
} from './constants';

/**
 * Lesson-plan document header — layout/sizing matched to TeacherLessonPlans.jsx
 * (SheetHeader / LogoGroup / SchoolDetails).
 */
export default function LessonPlanHeader({ address = LESSON_PLAN_SCHOOL_ADDRESS }) {
  const { region, division, district, school_id } = LESSON_PLAN_HEADER_META;
  const displayAddress = address || LESSON_PLAN_SCHOOL_ADDRESS;

  return (
    <div
      className="mb-[22px] grid grid-cols-1 items-center gap-6 text-center md:grid-cols-[270px_1fr] md:gap-6 md:text-left"
      style={{ fontFamily: '"Poppins", "Inter", "Segoe UI", sans-serif' }}
    >
      <div className="flex items-center justify-center gap-[14px] md:justify-start">
        <img
          src="/LCA-Icon.png"
          alt="Little Champions Academy"
          className="h-[88px] w-[88px] object-contain"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
        <img
          src="/depedlogo.png"
          alt="Department of Education"
          className="h-[66px] w-[148px] object-contain"
        />
      </div>

      <div className="flex flex-col gap-2">
        <h1 className="m-0 text-[30px] font-bold leading-[1.2] text-[#111111]">
          {LESSON_PLAN_SCHOOL_NAME}
        </h1>
        <p className="m-0 text-[15px] leading-[1.4] text-[#555555]">{displayAddress}</p>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 md:gap-x-3 md:gap-y-2">
          <span className="text-[13px] leading-[1.35] text-[#444444]">
            <strong className="font-semibold text-[#111111]">Region:</strong> {region}
          </span>
          <span className="text-[13px] leading-[1.35] text-[#444444]">
            <strong className="font-semibold text-[#111111]">Division:</strong> {division}
          </span>
          <span className="text-[13px] leading-[1.35] text-[#444444]">
            <strong className="font-semibold text-[#111111]">District:</strong> {district}
          </span>
          <span className="text-[13px] leading-[1.35] text-[#444444]">
            <strong className="font-semibold text-[#111111]">School ID:</strong> {school_id}
          </span>
        </div>
      </div>
    </div>
  );
}
