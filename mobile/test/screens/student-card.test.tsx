import { fireEvent, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { StudentCard } from "@/components/settings/student-card";
import { API } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderScreen } from "@/test/utils/render";

const profile = {
  fullName: "Sinh Vien Mau",
  gender: "Nam",
  cohort: "Khoa 47",
  className: "CTK47A",
  faculty: null,
  major: null,
  studentId: "2000000",
  studyProgramName: "CQ23CT-PM",
  gpa4: 3.85,
  gpa10: 9.1,
  creditsEarned: 101,
  ranking: "Xuat sac",
  marksFetchedAt: "2026-10-15T00:00:00.000Z",
};

describe("StudentCard", () => {
  it("shows the DLU profile with GPA and credits", () => {
    renderScreen(<StudentCard profile={profile} />);
    expect(screen.getByText("Sinh Vien Mau")).toBeTruthy();
    expect(screen.getByText(/CTK47A/)).toBeTruthy();
    expect(screen.getByText("3.85")).toBeTruthy();
    expect(screen.getByText("101")).toBeTruthy();
  });

  it("opens the marks grouped by semester", async () => {
    server.use(
      http.get(`${API}/users/me/marks`, () =>
        HttpResponse.json({
          data: {
            terms: [
              {
                yearStudy: "2023-2024",
                termId: "HK01",
                gpa4: 4,
                gpa10: 9.23,
                creditsEarned: 13,
                conductScore: 75,
                marks: [
                  {
                    curriculumId: "20CT1101",
                    curriculumName: "Nhap mon nganh CNTT",
                    credits: 3,
                    score10: 9.4,
                    score4: 4,
                    letter: "A",
                    passed: true,
                    noCredit: false,
                  },
                  {
                    curriculumId: "GDQP1",
                    curriculumName: "Giao duc quoc phong 1",
                    credits: 3,
                    score10: 8,
                    score4: 3,
                    letter: "B",
                    passed: true,
                    noCredit: true,
                  },
                ],
              },
            ],
          },
        }),
      ),
    );
    renderScreen(<StudentCard profile={profile} />);
    fireEvent.click(screen.getByText("Sinh Vien Mau"));
    expect(await screen.findByText("Nhap mon nganh CNTT")).toBeTruthy();
    expect(screen.getByText(/Semester 1 2023-2024/)).toBeTruthy();
    expect(screen.getByText("Giao duc quoc phong 1")).toBeTruthy();
    expect(screen.getByText("No credit")).toBeTruthy();
  });
});
